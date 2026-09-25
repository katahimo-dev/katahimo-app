import { beforeEach, describe, expect, it } from 'vitest';
import { computeLegacyHash } from '../../domain';
import { changePassword } from './changePassword';
import { login } from './login';
import { authenticateSession, logout, resolveSession } from './session';
import { decodeSessionCookie } from './sessionCookie';
import { importLegacyStaff, registerStaff } from './staffRegistration';
import type { AuthTestContext } from './testSetup';
import { createAuthTestContext } from './testSetup';

const DAY = 24 * 60 * 60 * 1000;

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
      isAdmin: false,
    });
    staffId = created.id;
  });

  const loginAs = (email: string, password = 'correct-horse', tenantSlug = 'test-tenant') =>
    login(ctx.deps, { tenantSlug, email, password });

  it('正しいテナント・メール・パスワードでログインでき、INFOログが残る', async () => {
    const result = await loginAs('hanako@example.com');
    if (!result.ok) throw new Error('unreachable');
    expect(result.staff).toMatchObject({ name: '佐藤 花子', email: 'hanako@example.com', isAdmin: false });
    expect(decodeSessionCookie(result.sessionCookieValue)?.tenantId).toBe(ctx.tenantId);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'INFO',
      action: 'auth.login.succeeded',
      actorStaffId: staffId,
      details: { loginIdType: 'email', migratedLegacyPassword: false },
    });
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
    ctx.staff.setRetirementDateForTest(ctx.tenantId, staffId, '2026-10-01');
    ctx.clock.now = new Date('2026-09-30T14:59:00Z'); // JST 9/30 23:59
    expect((await loginAs('hanako@example.com')).ok).toBe(true);
    ctx.clock.now = new Date('2026-09-30T15:30:00Z'); // JST 10/1 00:30
    expect(await loginAs('hanako@example.com')).toEqual({ ok: false, reason: 'retired' });
  });

  it('退職済みでもパスワードが違えば「退職」とは伝えない', async () => {
    ctx.staff.setRetirementDateForTest(ctx.tenantId, staffId, '2020-01-01');
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
      isAdmin: false,
    });
    expect(await loginAs('new@example.com', '')).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(ctx.appLog.entries.at(-1)?.details?.reason).toBe('password_not_set');
  });
});

describe('GAS版レガシーパスワードハッシュからの移行ログイン', () => {
  let ctx: AuthTestContext;
  const legacySalt = 'gas-auth-salt-example';

  beforeEach(async () => {
    ctx = await createAuthTestContext();
    ctx.deps.legacyAuthSalt = legacySalt;
    await importLegacyStaff(ctx.deps, {
      tenantId: ctx.tenantId,
      name: '鈴木 次郎',
      email: 'jiro@example.com',
      legacyPasswordHash: computeLegacyHash('legacy-password', legacySalt),
      isAdmin: false,
    });
  });

  const loginJiro = (password: string) =>
    login(ctx.deps, { tenantSlug: 'test-tenant', email: 'jiro@example.com', password });

  it('GAS版のパスワードのまま(変更なし)ログインでき、argon2idへサイレント再ハッシュされる', async () => {
    expect((await loginJiro('legacy-password')).ok).toBe(true);
    const record = await ctx.staff.findByLoginEmail(ctx.tenantId, 'jiro@example.com');
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
        isAdmin: true,
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
    expect(session).toMatchObject({ staffId, tenantId: ctx.tenantId, isAdmin: true, renewed: false });
  });

  it('残り6日を切ると7日に延長する(ローリング延長)', async () => {
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 0.5 * DAY);
    expect((await resolveSession(ctx.deps, cookie))?.renewed).toBe(false);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 1 * DAY);
    const renewed = await resolveSession(ctx.deps, cookie);
    expect(renewed?.renewed).toBe(true);
    expect(renewed?.expiresAt.getTime()).toBe(ctx.clock.now.getTime() + 7 * DAY);
  });

  it('期限切れのセッションは無効で、行も削除される', async () => {
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 8 * DAY);
    expect(await authenticateSession(ctx.deps, cookie)).toEqual({ ok: false, reason: 'expired' });
    expect(ctx.sessions.rows).toHaveLength(0);
  });

  it('毎回退職日を確認し、退職済みになったら無効にする', async () => {
    ctx.staff.setRetirementDateForTest(ctx.tenantId, staffId, '2026-09-25');
    expect(await authenticateSession(ctx.deps, cookie)).toEqual({ ok: false, reason: 'retired' });
    expect(ctx.sessions.rows).toHaveLength(0);
  });

  it('ページ読み込み時(isInitialLoad)だけ成功/失敗をログに残す', async () => {
    const before = ctx.appLog.entries.length;
    await authenticateSession(ctx.deps, cookie);
    await authenticateSession(ctx.deps, 'garbage');
    expect(ctx.appLog.entries.length).toBe(before);

    await authenticateSession(ctx.deps, cookie, { isInitialLoad: true });
    await authenticateSession(ctx.deps, `${ctx.tenantId}.unknown-token`, { isInitialLoad: true });
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

  it('ログアウトでセッション行が削除され、以後そのCookieは使えない', async () => {
    await logout(ctx.deps, cookie);
    expect(ctx.sessions.rows).toHaveLength(0);
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
        isAdmin: false,
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
    expect(await change('correct-horse', 'new-password-1')).toEqual({ ok: true });
    expect(ctx.sessions.rows.map((s) => s.id)).toEqual([sessionId]);
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
      staffId: 'no-such-staff',
      sessionId,
      currentPassword: 'correct-horse',
      newPassword: 'new-password-1',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_session' });
  });
});
