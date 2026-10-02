import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeLegacyHash } from '../../domain';
import type { UnitOfWorkPort } from '../../ports/unitOfWork';
import { DEFAULT_RATE_LIMIT_POLICY } from '../rateLimits';
import { changePassword } from './changePassword';
import type { AuthDeps } from './deps';
import { DEVICE_TRUST_TTL_MS, parseDeviceToken } from './deviceTrust';
import { login } from './login';
import { authenticateSession, logout } from './session';
import { decodeSessionCookie } from './sessionCookie';
import { registerStaff } from './staffRegistration';
import type { AuthTestContext } from './testSetup';
import { createAuthTestContext } from './testSetup';

const DAY = 24 * 60 * 60 * 1000;

async function resolveSession(deps: AuthDeps, cookie: string) {
  const result = await authenticateSession(deps, cookie);
  return result.ok ? result.session : null;
}

const UNKNOWN_TOKEN = 'f'.repeat(64);

describe('login', () => {
  let ctx: AuthTestContext;
  let staffId: string;

  beforeEach(async () => {
    ctx = await createAuthTestContext();
    const created = await registerStaff(ctx.deps, {
      tenantId: ctx.tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      altEmail: 'hanako@cutest.biz',
      password: 'correct-horse',
      role: 'staff',
    });
    staffId = created.id;
  });

  const loginAs = (email: string, password = 'correct-horse', tenantSlug = 'test-tenant') =>
    login(ctx.deps, { tenantSlug, email, password });

  it('正しいテナント・メール・パスワードでログインでき、INFOログが残る', async () => {
    const result = await loginAs('hanako@example.com');
    if (!result.ok) throw new Error('unreachable');
    expect(result.staff).toMatchObject({ name: '佐藤 花子', email: 'hanako@example.com', role: 'staff' });
    expect(decodeSessionCookie(result.sessionCookieValue)?.tenantId).toBe(ctx.tenantId);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'INFO',
      action: 'auth.login.succeeded',
      actorStaffId: staffId,
      details: { loginIdType: 'email', migratedLegacyPassword: false },
    });
  });

  it('同時に送られた多数の誤ったパスワードでも、照合まで進むのは上限の回数まで(枠を先に取る)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount.limit;
    const results = await Promise.all(
      Array.from({ length: limit * 3 }, () => loginAs('hanako@example.com', 'wrong-password')),
    );
    expect(ctx.deps.passwordHasher.verifications).toBeLessThanOrEqual(limit);
    expect(results.filter((r) => !r.ok && r.reason === 'locked')).toHaveLength(limit * 2);
    // ロック中は正しいパスワードでも照合しない
    expect(await loginAs('hanako@example.com')).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('成功した回は数えない(アカウントは数え直し、送信元IPの枠は1回分を返す)', async () => {
    const meta = { ip: '203.0.113.7' };
    const ipRule = DEFAULT_RATE_LIMIT_POLICY.loginFailureIp;
    const ipBucket = () => ctx.deps.rateLimiter.buckets.get(`${ipRule.name}|${meta.ip}`);
    await login(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@example.com', password: 'x', meta });
    expect(ipBucket()?.count).toBe(1);
    await login(ctx.deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
      meta,
    });
    expect(ipBucket()?.count).toBe(1);
    const accountRule = DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount;
    expect([...ctx.deps.rateLimiter.buckets.keys()].some((k) => k.startsWith(accountRule.name))).toBe(false);
  });

  it('サブメール(alt_email)でもログインできる(GAS版M列)', async () => {
    const result = await loginAs(' Hanako@Cutest.biz ');
    expect(result.ok).toBe(true);
    expect(ctx.appLog.entries.at(-1)?.details).toMatchObject({ loginIdType: 'alt_email' });
  });

  it('パスワード違い・未登録メール・未知のテナントは同じ結果を返し(列挙防止)、SECURITYログを残す', async () => {
    const results = await Promise.all([
      loginAs('hanako@example.com', 'wrong'),
      loginAs('nobody@example.com'),
      loginAs('hanako@example.com', 'correct-horse', 'no-such-tenant'),
    ]);
    expect(results).toEqual(Array(3).fill({ ok: false, reason: 'invalid_credentials' }));
    const failures = ctx.appLog.entries.filter((e) => e.action === 'auth.login.failed');
    expect(failures.map((e) => e.level)).toEqual(['SECURITY', 'SECURITY', 'SECURITY']);
    expect(failures.map((e) => e.details?.reason).sort()).toEqual(
      ['invalid_password', 'tenant_not_found', 'unknown_login_id'].sort(),
    );
    const tenantUnknown = failures.find((e) => e.details?.reason === 'tenant_not_found');
    expect(tenantUnknown?.tenantId).toBeNull();
    expect(tenantUnknown?.details?.loginId).toBe('ha***@example.com');
  });

  it('退職日の当日以降はログインできない(JSTで判定。UTCでは前日の時間帯でも当日扱い)', async () => {
    ctx.setRetiredOn(staffId, '2026-10-01');
    ctx.clock.now = new Date('2026-09-30T14:59:00Z'); // JST 9/30 23:59
    expect((await loginAs('hanako@example.com')).ok).toBe(true);
    ctx.clock.now = new Date('2026-09-30T15:30:00Z'); // JST 10/1 00:30
    expect(await loginAs('hanako@example.com')).toEqual({ ok: false, reason: 'retired' });
  });

  it('退職済みでもパスワードが違えば「退職」とは伝えない', async () => {
    ctx.setRetiredOn(staffId, '2020-01-01');
    expect(await loginAs('hanako@example.com', 'wrong')).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });

  it('パスワード未設定のスタッフはログインできない', async () => {
    await registerStaff(ctx.deps, {
      tenantId: ctx.tenantId,
      name: '新人',
      email: 'new@example.com',
      role: 'staff',
    });
    expect(await loginAs('new@example.com', '')).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(ctx.appLog.entries.at(-1)?.details?.reason).toBe('password_not_set');
  });

  it('照合するハッシュが無い場合(未知のテナント・未登録メール)もダミーのargon2照合で時間をかける', async () => {
    await loginAs('nobody@example.com');
    await loginAs('hanako@example.com', 'correct-horse', 'no-such-tenant');
    expect(ctx.passwordHasher.dummyVerifications).toBe(2);
    await loginAs('hanako@example.com', 'wrong');
    expect(ctx.passwordHasher.dummyVerifications).toBe(2);
  });

  it(`アカウント単位で${DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount.limit}回失敗すると15分ロックし、正しいパスワードでも拒否する`, async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount.limit;
    for (let i = 0; i < limit; i++) {
      expect(await loginAs('hanako@example.com', 'wrong')).toEqual({
        ok: false,
        reason: 'invalid_credentials',
      });
    }
    expect(ctx.appLog.byAction('auth.login.lockout_started')).toHaveLength(1);
    expect(await loginAs('hanako@example.com')).toMatchObject({ ok: false, reason: 'locked' });
    // 大文字・空白の違いでもロックを回避できない
    expect(await loginAs(' HANAKO@example.com ')).toMatchObject({ ok: false, reason: 'locked' });
    expect(ctx.appLog.byAction('auth.login.locked').at(-1)).toMatchObject({
      level: 'SECURITY',
      details: { scope: 'account' },
    });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 15 * 60 * 1000);
    expect((await loginAs('hanako@example.com')).ok).toBe(true);
  });

  it('存在しないアカウントも同じように数えてロックする(ロックの有無からアカウントの有無が分からない)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount.limit;
    for (let i = 0; i < limit; i++) await loginAs('nobody@example.com');
    expect(await loginAs('nobody@example.com')).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('成功するとアカウント単位の失敗回数は戻る', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount.limit;
    for (let i = 0; i < limit - 1; i++) await loginAs('hanako@example.com', 'wrong');
    expect((await loginAs('hanako@example.com')).ok).toBe(true);
    for (let i = 0; i < limit - 1; i++) await loginAs('hanako@example.com', 'wrong');
    expect((await loginAs('hanako@example.com')).ok).toBe(true);
  });

  it('送信元IP単位でも失敗を数え、多数のアカウントへの総当たりをロックする', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.loginFailureIp.limit;
    const fromIp = (email: string, password: string, ip: string) =>
      login(ctx.deps, { tenantSlug: 'test-tenant', email, password, meta: { ip } });
    for (let i = 0; i < limit; i++) await fromIp(`user${i}@example.com`, 'guess', '198.51.100.9');
    expect(await fromIp('hanako@example.com', 'correct-horse', '198.51.100.9')).toMatchObject({
      ok: false,
      reason: 'locked',
    });
    expect((await fromIp('hanako@example.com', 'correct-horse', '198.51.100.10')).ok).toBe(true);
  });

  it('IPv6 は /64 ごとに数える(同じ /64 のアドレスを替えても回避できない。ログには元のアドレスを残す)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.loginFailureIp.limit;
    const fromIp = (email: string, password: string, ip: string) =>
      login(ctx.deps, { tenantSlug: 'test-tenant', email, password, meta: { ip } });
    for (let i = 0; i < limit; i++) {
      await fromIp(`user${i}@example.com`, 'guess', `2001:db8:1:2::${(i + 1).toString(16)}`);
    }
    expect(await fromIp('hanako@example.com', 'correct-horse', '2001:db8:1:2:ffff::1')).toMatchObject({
      ok: false,
      reason: 'locked',
    });
    expect(ctx.appLog.byAction('auth.login.locked')[0]).toMatchObject({ ip: '2001:db8:1:2:ffff::1' });
    // 別の /64 は断らない
    expect((await fromIp('hanako@example.com', 'correct-horse', '2001:db8:1:3::1')).ok).toBe(true);
  });

  it('停止中(suspended)のテナントは、パスワードが正しくてもログインできない', async () => {
    ctx.setTenantStatus('suspended');
    expect(await loginAs('hanako@example.com')).toEqual({ ok: false, reason: 'tenant_suspended' });
    expect(await loginAs('hanako@example.com', 'wrong')).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    expect(ctx.data().sessions).toHaveLength(0);
  });
});

describe('「この端末」の印(アカウントのロックの妨害への対策)', () => {
  let ctx: AuthTestContext;
  let staffId: string;
  const limit = DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount.limit;

  beforeEach(async () => {
    ctx = await createAuthTestContext();
    staffId = (
      await registerStaff(ctx.deps, {
        tenantId: ctx.tenantId,
        name: '佐藤 花子',
        email: 'hanako@example.com',
        password: 'correct-horse',
        role: 'staff',
      })
    ).id;
    await registerStaff(ctx.deps, {
      tenantId: ctx.tenantId,
      name: '鈴木 次郎',
      email: 'jiro@example.com',
      password: 'jiro-password',
      role: 'staff',
    });
  });

  const attempt = (password: string, deviceToken?: string, email = 'hanako@example.com', ip?: string) =>
    login(ctx.deps, {
      tenantSlug: 'test-tenant',
      email,
      password,
      ...(deviceToken ? { deviceToken } : {}),
      ...(ip ? { meta: { ip } } : {}),
    });
  const deviceOf = async (email = 'hanako@example.com', password = 'correct-horse') => {
    const result = await attempt(password, undefined, email);
    if (!result.ok) throw new Error('ログインできません');
    return result.deviceToken.value;
  };
  const lockAccount = async () => {
    for (let i = 0; i < limit; i++) await attempt('wrong');
    expect(await attempt('correct-horse')).toMatchObject({ ok: false, reason: 'locked' });
  };

  it('ログインの成功で180日の印を発行し、値にはテナント・スタッフのIDのほか個人情報を入れない', async () => {
    const result = await attempt('correct-horse');
    if (!result.ok) throw new Error('unreachable');
    const parsed = parseDeviceToken(result.deviceToken.value);
    expect(parsed).toMatchObject({ tenantId: ctx.tenantId, staffId });
    expect(result.deviceToken.value).not.toContain('hanako');
    expect(result.deviceToken.expiresAt.getTime() - ctx.clock.now.getTime()).toBe(DEVICE_TRUST_TTL_MS);
  });

  it('アカウントがロック中でも、正しい印のある端末からは正しいパスワードでログインできる', async () => {
    const token = await deviceOf();
    await lockAccount();
    const result = await attempt('correct-horse', token);
    expect(result.ok).toBe(true);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      action: 'auth.login.succeeded',
      details: { device: 'trusted' },
    });
    // 端末の印での成功ではアカウント単位の回数を戻さない(第三者の試行の枠を戻さない)
    expect(await attempt('correct-horse')).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('印のある端末の失敗は端末単位で数え、上限で端末もロックする(アカウント単位には数えない)', async () => {
    const token = await deviceOf();
    const deviceLimit = DEFAULT_RATE_LIMIT_POLICY.loginFailureDevice.limit;
    for (let i = 0; i < deviceLimit; i++) {
      expect(await attempt('wrong', token)).toEqual({ ok: false, reason: 'invalid_credentials' });
    }
    expect(await attempt('correct-horse', token)).toMatchObject({ ok: false, reason: 'locked' });
    expect(ctx.appLog.byAction('auth.login.locked').at(-1)?.details).toMatchObject({ scope: 'device' });
    expect(ctx.appLog.byAction('auth.login.lockout_started').at(-1)?.details).toMatchObject({
      scope: 'device',
    });
    // アカウント単位は減っていないので、印の無い端末からはログインできる
    expect((await attempt('correct-horse')).ok).toBe(true);
  });

  it('別のアカウントの印・書き換えた印・形の不正な印は使えず、ふつうのアカウントのロックに従う', async () => {
    const jiroToken = await deviceOf('jiro@example.com', 'jiro-password');
    const own = await deviceOf();
    await lockAccount();
    expect(await attempt('correct-horse', jiroToken)).toMatchObject({ ok: false, reason: 'locked' });
    const forged = `${own.slice(0, -1)}${own.endsWith('A') ? 'B' : 'A'}`;
    expect(await attempt('correct-horse', forged)).toMatchObject({ ok: false, reason: 'locked' });
    const otherStaff = own.replace(staffId, '00000000-0000-7000-8000-000000000001');
    expect(await attempt('correct-horse', otherStaff)).toMatchObject({ ok: false, reason: 'locked' });
    expect(await attempt('correct-horse', 'garbage')).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('期限(180日)を過ぎた印は使えない', async () => {
    const token = await deviceOf();
    ctx.clock.now = new Date(ctx.clock.now.getTime() + DEVICE_TRUST_TTL_MS);
    await lockAccount();
    expect(await attempt('correct-horse', token)).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('パスワードを変えると、それより前に発行した印は使えなくなる', async () => {
    const token = await deviceOf();
    const session = ctx.data().sessions.at(-1);
    if (!session) throw new Error('unreachable');
    expect(
      (
        await changePassword(ctx.deps, {
          tenantId: ctx.tenantId,
          staffId,
          sessionId: session.id,
          currentPassword: 'correct-horse',
          newPassword: 'brand-new-pass',
        })
      ).ok,
    ).toBe(true);
    for (let i = 0; i < limit; i++) await attempt('wrong');
    expect(await attempt('brand-new-pass', token)).toMatchObject({ ok: false, reason: 'locked' });
  });

  it('退職日を設定すると、それより前に発行した印は使えなくなる', async () => {
    const token = await deviceOf();
    ctx.setRetiredOn(staffId, '2027-01-01');
    await lockAccount();
    expect(await attempt('correct-horse', token)).toMatchObject({ ok: false, reason: 'locked' });
  });

  /** テナント・スタッフ・資格情報の読み取りを数える依存(応答時間の差を生む DB の読み方の確認用)。 */
  const countingDeps = () => {
    const reads = { tenants: 0, runs: 0, staff: 0, credentials: 0 };
    const findBySlug = ctx.deps.tenants.findBySlug.bind(ctx.deps.tenants);
    vi.spyOn(ctx.deps.tenants, 'findBySlug').mockImplementation((slug) => {
      reads.tenants++;
      return findBySlug(slug);
    });
    const uow: UnitOfWorkPort = {
      run: (tenantId, work) => {
        reads.runs++;
        return ctx.deps.uow.run(tenantId, (r) =>
          work({
            ...r,
            staff: {
              ...r.staff,
              findByLoginEmail: (loginId) => {
                reads.staff++;
                return r.staff.findByLoginEmail(loginId);
              },
              getCredentials: (id) => {
                reads.credentials++;
                return r.staff.getCredentials(id);
              },
            },
          }),
        );
      },
    };
    return { deps: { ...ctx.deps, uow }, reads };
  };

  it('形の正しい印の無い要求は、アカウントがロック中ならテナント・スタッフを引かずに断る(応答時間からアカウントの有無が分からない)', async () => {
    await lockAccount();
    for (let i = 0; i < limit; i++) await attempt('wrong', undefined, 'nobody@example.com');
    const { deps, reads } = countingDeps();
    for (const deviceToken of [undefined, 'garbage']) {
      expect(
        await login(deps, {
          tenantSlug: 'test-tenant',
          email: 'hanako@example.com',
          password: 'correct-horse',
          ...(deviceToken ? { deviceToken } : {}),
        }),
      ).toMatchObject({ ok: false, reason: 'locked' });
    }
    expect(reads).toEqual({ tenants: 0, runs: 0, staff: 0, credentials: 0 });
    // 存在しないアカウントのロックも同じ
    await login(deps, { tenantSlug: 'test-tenant', email: 'nobody@example.com', password: 'x' });
    expect(reads).toEqual({ tenants: 0, runs: 0, staff: 0, credentials: 0 });
  });

  it('印のある要求は、アカウントの有無にかかわらず同じ問い合わせ(スタッフ・資格情報)をする', async () => {
    const token = await deviceOf();
    const { deps, reads } = countingDeps();
    const tryWith = (email: string) =>
      login(deps, { tenantSlug: 'test-tenant', email, password: 'wrong', deviceToken: token });
    await tryWith('hanako@example.com');
    const existing = { ...reads };
    expect(existing).toMatchObject({ tenants: 1, staff: 1, credentials: 1 });
    await tryWith('nobody@example.com');
    expect({
      tenants: reads.tenants - existing.tenants,
      staff: reads.staff - existing.staff,
      credentials: reads.credentials - existing.credentials,
    }).toEqual({ tenants: 1, staff: 1, credentials: 1 });
    // 無いアカウントも、ダミーの argon2 照合で時間をかける
    expect(ctx.passwordHasher.dummyVerifications).toBeGreaterThan(0);
  });

  it('送信元IPでロック中の要求はアカウント単位の回数に数えない', async () => {
    const ipLimit = DEFAULT_RATE_LIMIT_POLICY.loginFailureIp.limit;
    for (let i = 0; i < ipLimit; i++)
      await attempt('guess', undefined, `user${i}@example.com`, '198.51.100.20');
    const accountRule = DEFAULT_RATE_LIMIT_POLICY.loginFailureAccount;
    const accountBuckets = () =>
      [...ctx.rateLimiter.buckets.keys()].filter((k) => k.endsWith(':hanako@example.com')).length;
    for (let i = 0; i < limit * 2; i++) {
      expect(await attempt('wrong', undefined, 'hanako@example.com', '198.51.100.20')).toMatchObject({
        ok: false,
        reason: 'locked',
      });
    }
    expect(accountBuckets()).toBe(0);
    expect(ctx.rateLimiter.buckets.has(`${accountRule.name}|test-tenant:hanako@example.com`)).toBe(false);
    // 別のIPの本人は締め出されない
    expect((await attempt('correct-horse', undefined, 'hanako@example.com', '198.51.100.21')).ok).toBe(true);
  });
});

describe('GAS版レガシーパスワードハッシュからの移行ログイン', () => {
  let ctx: AuthTestContext;
  const legacySalt = 'gas-auth-salt-example';

  beforeEach(async () => {
    ctx = await createAuthTestContext();
    ctx.deps.legacyAuthSalt = legacySalt;
    await registerStaff(ctx.deps, {
      tenantId: ctx.tenantId,
      name: '鈴木 次郎',
      email: 'jiro@example.com',
      legacyPasswordHash: computeLegacyHash('legacy-password', legacySalt),
      role: 'staff',
    });
  });

  const loginJiro = (password: string) =>
    login(ctx.deps, { tenantSlug: 'test-tenant', email: 'jiro@example.com', password });

  it('GAS版のパスワードのまま(変更なし)ログインでき、argon2idへサイレント再ハッシュされる', async () => {
    expect((await loginJiro('legacy-password')).ok).toBe(true);
    const record = ctx.data().staff.find((s) => s.record.email === 'jiro@example.com')?.credentials;
    expect(record?.passwordHash).toBe('HASH:legacy-password');
    expect(record?.legacyPasswordHash).toBeNull();
    expect((await loginJiro('legacy-password')).ok).toBe(true);
  });

  it('間違ったパスワードではレガシーハッシュ経由でもログインできない', async () => {
    expect(await loginJiro('wrong')).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('legacyAuthSaltが未設定の場合、レガシーハッシュ経由のログインはできない', async () => {
    ctx.deps.legacyAuthSalt = undefined;
    expect(await loginJiro('legacy-password')).toEqual({ ok: false, reason: 'invalid_credentials' });
  });
});

describe('authenticateSession / logout', () => {
  let ctx: AuthTestContext;
  let staffId: string;
  let cookie: string;

  beforeEach(async () => {
    ctx = await createAuthTestContext();
    staffId = (
      await registerStaff(ctx.deps, {
        tenantId: ctx.tenantId,
        name: '佐藤 花子',
        email: 'hanako@example.com',
        password: 'correct-horse',
        role: 'admin',
      })
    ).id;
    const result = await login(ctx.deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'correct-horse',
    });
    if (!result.ok) throw new Error('unreachable');
    cookie = result.sessionCookieValue;
  });

  it('ログイン後のCookieで本人を解決できる', async () => {
    const session = await resolveSession(ctx.deps, cookie);
    expect(session).toMatchObject({ staffId, tenantId: ctx.tenantId, role: 'admin', renewed: false });
  });

  it('残り6日を切ると7日に延長する(ローリング延長)', async () => {
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 0.5 * DAY);
    expect((await resolveSession(ctx.deps, cookie))?.renewed).toBe(false);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 1 * DAY);
    const renewed = await resolveSession(ctx.deps, cookie);
    expect(renewed?.renewed).toBe(true);
    expect(renewed?.expiresAt.getTime()).toBe(ctx.clock.now.getTime() + 7 * DAY);
  });

  it('期限切れのセッションは無効(行は保守ジョブが消す)', async () => {
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 8 * DAY);
    expect(await authenticateSession(ctx.deps, cookie)).toEqual({ ok: false, reason: 'expired' });
  });

  it('延長を続けても、ログインから30日を過ぎたセッションは無効にする(絶対的な有効期間)', async () => {
    for (let day = 1; day <= 29; day++) {
      ctx.clock.now = new Date(ctx.clock.now.getTime() + DAY);
      const session = await resolveSession(ctx.deps, cookie);
      expect(session).not.toBeNull();
      // 延長後の期限もログインから30日を超えない
      expect(session?.expiresAt.getTime()).toBeLessThanOrEqual(
        new Date('2026-09-25T03:00:00Z').getTime() + 30 * DAY,
      );
    }
    ctx.clock.now = new Date(new Date('2026-09-25T03:00:00Z').getTime() + 30 * DAY);
    expect(await authenticateSession(ctx.deps, cookie)).toEqual({ ok: false, reason: 'lifetime_exceeded' });
  });

  it('テナントが停止されたら既存のセッションも使えない', async () => {
    ctx.setTenantStatus('suspended');
    expect(await authenticateSession(ctx.deps, cookie)).toEqual({ ok: false, reason: 'tenant_suspended' });
    ctx.setTenantStatus('active');
    expect(await resolveSession(ctx.deps, cookie)).not.toBeNull();
  });

  it('毎回退職日を確認し、退職済みになったら無効にする', async () => {
    ctx.setRetiredOn(staffId, '2026-09-25');
    expect(await authenticateSession(ctx.deps, cookie)).toEqual({ ok: false, reason: 'retired' });
    expect(ctx.data().sessions.every((s) => s.revokedAt)).toBe(true);
  });

  it('ページ読み込み時(isInitialLoad)だけ成功/失敗をログに残す', async () => {
    const before = ctx.appLog.entries.length;
    await authenticateSession(ctx.deps, cookie);
    await authenticateSession(ctx.deps, 'garbage');
    expect(ctx.appLog.entries.length).toBe(before);

    await authenticateSession(ctx.deps, cookie, { isInitialLoad: true });
    await authenticateSession(ctx.deps, `${ctx.tenantId}.${UNKNOWN_TOKEN}`, { isInitialLoad: true });
    expect(ctx.appLog.entries.slice(before)).toEqual([
      expect.objectContaining({ level: 'INFO', action: 'auth.session.auto_login', actorStaffId: staffId }),
      expect.objectContaining({
        level: 'WARN',
        action: 'auth.session.auto_login_failed',
        tenantId: null,
        details: { reason: 'unknown_token' },
      }),
    ]);
  });

  it('失敗のログは failureLogGate が null を返せば書かず、書くときは間引いた件数を残す', async () => {
    const before = ctx.appLog.entries.length;
    const bad = `${ctx.tenantId}.${UNKNOWN_TOKEN}`;
    await authenticateSession(ctx.deps, bad, { isInitialLoad: true, failureLogGate: () => null });
    expect(ctx.appLog.entries.length).toBe(before);
    await authenticateSession(ctx.deps, bad, {
      isInitialLoad: true,
      failureLogGate: () => ({ suppressed: 3 }),
    });
    expect(ctx.appLog.entries.slice(before)).toEqual([
      expect.objectContaining({
        action: 'auth.session.auto_login_failed',
        details: { reason: 'unknown_token', suppressed: 3 },
      }),
    ]);
    // 成功は間引かない
    await authenticateSession(ctx.deps, cookie, { isInitialLoad: true, failureLogGate: () => null });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({ action: 'auth.session.auto_login' });
  });

  it('ログアウトでセッションが失効し、以後そのCookieは使えない', async () => {
    await logout(ctx.deps, cookie);
    expect(ctx.data().sessions[0]?.revokedAt).not.toBeNull();
    expect(await resolveSession(ctx.deps, cookie)).toBeNull();
  });

  it('不正なCookie値(区切りが無い等)は無効', async () => {
    expect(await authenticateSession(ctx.deps, 'not-a-valid-cookie-value')).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });
});

describe('changePassword', () => {
  let ctx: AuthTestContext;
  let staffId: string;
  let sessionId: string;

  beforeEach(async () => {
    ctx = await createAuthTestContext();
    staffId = (
      await registerStaff(ctx.deps, {
        tenantId: ctx.tenantId,
        name: '佐藤 花子',
        email: 'hanako@example.com',
        password: 'correct-horse',
        role: 'staff',
      })
    ).id;
    const loginOnce = () =>
      login(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@example.com', password: 'correct-horse' });
    const current = await loginOnce();
    await loginOnce(); // 別端末のセッション
    if (!current.ok) throw new Error('unreachable');
    sessionId = (await resolveSession(ctx.deps, current.sessionCookieValue))?.sessionId ?? '';
  });

  const change = (currentPassword: string, newPassword: string) =>
    changePassword(ctx.deps, { tenantId: ctx.tenantId, staffId, sessionId, currentPassword, newPassword });

  it('現在のパスワードが正しければ変更でき、操作中以外のセッションは失効する', async () => {
    expect(await change('correct-horse', 'new-password-1')).toMatchObject({ ok: true });
    expect(
      ctx
        .data()
        .sessions.filter((s) => !s.revokedAt)
        .map((s) => s.id),
    ).toEqual([sessionId]);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'auth.password_change.succeeded',
    });
    const relogin = await login(ctx.deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@example.com',
      password: 'new-password-1',
    });
    expect(relogin.ok).toBe(true);
  });

  it('現在のパスワードが間違っていれば拒否し、SECURITYログを残す', async () => {
    expect(await change('wrong-password', 'new-password-1')).toEqual({
      ok: false,
      reason: 'incorrect_current_password',
    });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'auth.password_change.failed',
      details: { reason: 'incorrect_current_password' },
    });
  });

  it(`現在のパスワードの誤りはスタッフ単位で${DEFAULT_RATE_LIMIT_POLICY.passwordChangeFailureStaff.limit}回まで、その後は正しくても15分ロック(WARN)`, async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordChangeFailureStaff.limit;
    for (let i = 0; i < limit; i++) {
      expect(await change('wrong-password', 'new-password-1')).toEqual({
        ok: false,
        reason: 'incorrect_current_password',
      });
    }
    expect(ctx.appLog.byAction('auth.password_change.lockout_started')).toHaveLength(1);
    const before = ctx.passwordHasher.verifications;
    expect(await change('correct-horse', 'new-password-1')).toMatchObject({ ok: false, reason: 'locked' });
    // ロック中は照合しない
    expect(ctx.passwordHasher.verifications).toBe(before);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'WARN',
      action: 'auth.password_change.locked',
      actorStaffId: staffId,
    });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 15 * 60 * 1000);
    expect((await change('correct-horse', 'new-password-1')).ok).toBe(true);
  });

  it('同時に送られた多数の誤りでも、照合まで進むのは上限の回数まで', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordChangeFailureStaff.limit;
    const before = ctx.passwordHasher.verifications;
    const results = await Promise.all(
      Array.from({ length: limit * 3 }, () => change('wrong-password', 'new-password-1')),
    );
    expect(ctx.passwordHasher.verifications - before).toBeLessThanOrEqual(limit);
    expect(results.filter((r) => !r.ok && r.reason === 'locked')).toHaveLength(limit * 2);
  });

  it('成功すると誤りの回数は戻り、新しいパスワードの「この端末」の印を返す', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordChangeFailureStaff.limit;
    for (let i = 0; i < limit - 1; i++) await change('wrong-password', 'new-password-1');
    const result = await change('correct-horse', 'new-password-1');
    if (!result.ok) throw new Error('unreachable');
    expect(parseDeviceToken(result.deviceToken.value)).toMatchObject({ tenantId: ctx.tenantId, staffId });
    for (let i = 0; i < limit - 1; i++) await change('wrong-password', 'new-password-2');
    expect((await change('new-password-1', 'new-password-2')).ok).toBe(true);
  });

  it('新しいパスワードが空・短すぎる場合は拒否する', async () => {
    expect(await change('correct-horse', '')).toEqual({
      ok: false,
      reason: 'weak_password',
      violation: 'empty',
    });
    expect(await change('correct-horse', 'short')).toEqual({
      ok: false,
      reason: 'weak_password',
      violation: 'too_short',
    });
  });

  it('存在しないstaffIdでは無効セッション扱いにする', async () => {
    const result = await changePassword(ctx.deps, {
      tenantId: ctx.tenantId,
      staffId: '00000000-0000-7000-8000-00000000ffff',
      sessionId,
      currentPassword: 'correct-horse',
      newPassword: 'new-password-1',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_session' });
  });
});
