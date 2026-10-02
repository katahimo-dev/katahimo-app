import { beforeEach, describe, expect, it } from 'vitest';
import { withOutboxDrainTrigger } from '../outboxDrainTrigger';
import { DEFAULT_RATE_LIMIT_POLICY } from '../rateLimits';
import { login } from './login';
import {
  buildPasswordResetMail,
  confirmPasswordReset,
  RESET_CODE_MAX_ATTEMPTS,
  requestPasswordReset,
} from './passwordReset';
import { registerStaff } from './staffRegistration';
import type { AuthTestContext } from './testSetup';
import { createAuthTestContext } from './testSetup';

describe('パスワード再設定', () => {
  let ctx: AuthTestContext;
  let staffId: string;

  beforeEach(async () => {
    ctx = await createAuthTestContext();
    staffId = (
      await registerStaff(ctx.deps, {
        tenantId: ctx.tenantId,
        name: '佐藤 花子',
        email: 'hanako@gmail.com',
        altEmail: 'hanako@cutest.biz',
        password: 'old-password',
        role: 'staff',
      })
    ).id;
  });

  const request = async (email = 'hanako@gmail.com', tenantSlug = 'test-tenant', ip = '203.0.113.1') => {
    const outcome = await requestPasswordReset(ctx.deps, { tenantSlug, email, meta: { ip } });
    await ctx.drain();
    return outcome.status;
  };
  const lastCode = () => /コード: (\d{8})/.exec(ctx.mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
  const confirm = (code: string, newPassword = 'brand-new-pass', email = 'hanako@gmail.com') =>
    confirmPasswordReset(ctx.deps, {
      tenantSlug: 'test-tenant',
      email,
      code,
      newPassword,
      meta: { ip: '203.0.113.1' },
    });
  const wrongCodeFor = (code: string) => (code === '12345678' ? '87654321' : '12345678');

  it('8桁のコードをGAS版と同じ文面でメール送信し(ワーカー経由)、送信後はDBにハッシュだけが残る', async () => {
    const outcome = await requestPasswordReset(ctx.deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@gmail.com',
    });
    expect(outcome).toEqual({ status: 'queued' });
    // リクエストの中では送らず、outboxに積むだけ(応答時間からアカウントの有無が分からないように)
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(ctx.data().outbox.map((j) => j.topic)).toEqual(['mail.password_reset']);
    expect(ctx.data().resetCodes[0]?.mailCode).toMatch(/^[1-9]\d{7}$/);
    // outbox の payload にはコードを入れない
    expect(JSON.stringify(ctx.data().outbox[0]?.payload ?? {})).not.toContain(
      ctx.data().resetCodes[0]?.mailCode,
    );
    await ctx.drain();
    const mail = ctx.mailer.sent[0];
    expect(mail?.to).toBe('hanako@gmail.com');
    expect(mail?.subject).toBe('【保育日報】パスワード再設定認証コード');
    expect(mail?.text).toMatch(
      /^パスワード再設定のリクエストを受け付けました。\n以下の認証コードを入力してください。\n\nコード: \d{8}\n有効期限: 30分$/,
    );
    const row = ctx.data().resetCodes[0];
    expect(row?.codeHash).not.toContain(lastCode());
    expect(row?.mailCode).toBeNull();
    expect(row?.expiresAt.getTime()).toBe(ctx.clock.now.getTime() + 30 * 60 * 1000);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'auth.password_reset.requested',
    });
  });

  it('サブメールで要求した場合はサブメール宛に送る', async () => {
    await request('HANAKO@cutest.biz');
    expect(ctx.mailer.sent[0]?.to).toBe('hanako@cutest.biz');
  });

  it('未登録のメール・未知のテナント・退職者・停止中のテナントには送らず、WARNログだけ残す', async () => {
    expect(await request('nobody@example.com')).toBe('rejected');
    expect(await request('hanako@gmail.com', 'no-such')).toBe('rejected');
    ctx.setRetiredOn(staffId, '2026-01-01');
    expect(await request()).toBe('rejected');
    ctx.setRetiredOn(staffId, null);
    ctx.setTenantStatus('suspended');
    expect(await request()).toBe('rejected');
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(ctx.data().outbox).toHaveLength(0);
    expect(ctx.appLog.entries.map((e) => [e.level, e.details?.reason])).toEqual([
      ['WARN', 'unknown_login_id'],
      ['WARN', 'tenant_not_found'],
      ['WARN', 'retired'],
      ['WARN', 'tenant_suspended'],
    ]);
  });

  it('正しいコードで再設定でき、コードは1回しか使えず、既存セッションは失効する', async () => {
    await login(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@gmail.com', password: 'old-password' });
    await request();
    const code = lastCode();
    expect(await confirm(code)).toEqual({ ok: true });
    expect(ctx.data().sessions.every((s) => s.revokedAt)).toBe(true);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'auth.password_reset.completed',
    });
    expect(
      (
        await login(ctx.deps, {
          tenantSlug: 'test-tenant',
          email: 'hanako@gmail.com',
          password: 'brand-new-pass',
        })
      ).ok,
    ).toBe(true);
    expect(await confirm(code, 'another-pass-1')).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('新しいコードを発行すると古いコードは使えなくなる', async () => {
    await request();
    const oldCode = lastCode();
    await request();
    const newCode = lastCode();
    if (oldCode === newCode) return; // 偶然同じ値が出た場合は判定できないため省略
    expect(await confirm(oldCode)).toEqual({ ok: false, reason: 'invalid_code' });
    expect(await confirm(newCode)).toEqual({ ok: true });
  });

  it('30分を過ぎたコードは期限切れ', async () => {
    await request();
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * 60 * 1000);
    expect(await confirm(lastCode())).toEqual({ ok: false, reason: 'expired' });
  });

  it(`入力が${RESET_CODE_MAX_ATTEMPTS}回に達するとコードは無効になり、正しいコードでも再設定できない`, async () => {
    await request();
    const code = lastCode();
    const results = [];
    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS; i++)
      results.push((await confirm(wrongCodeFor(code))).ok ? 'ok' : 'ng');
    expect(results).toEqual(Array(RESET_CODE_MAX_ATTEMPTS).fill('ng'));
    expect(await confirm(code)).toEqual({ ok: false, reason: 'invalid_code' });
    expect(
      ctx.appLog.entries.filter((e) => e.action === 'auth.password_reset.failed').at(-2)?.details,
    ).toEqual({
      reason: 'too_many_attempts',
    });
  });

  it(`${RESET_CODE_MAX_ATTEMPTS}回目の入力が正しいコードなら再設定できる(正しい入力も1回に数える)`, async () => {
    await request();
    const code = lastCode();
    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS - 1; i++) await confirm(wrongCodeFor(code));
    expect(await confirm(code)).toEqual({ ok: true });
  });

  it('並列に送られた大量の確認でも上限を超えて試せず、後から正しいコードを送っても通らない', async () => {
    await request();
    const code = lastCode();
    const results = await Promise.all(Array.from({ length: 40 }, () => confirm(wrongCodeFor(code))));
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(ctx.data().resetCodes[0]?.attemptCount).toBe(RESET_CODE_MAX_ATTEMPTS);
    expect((await confirm(code)).ok).toBe(false);
  });

  it('同じ正しいコードでの同時の再設定は1件だけ成功する', async () => {
    await request();
    const code = lastCode();
    const results = await Promise.all([confirm(code), confirm(code), confirm(code)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('発行要求はアカウント単位で1時間の上限を超えると送信せず、既存のコードも無効にしない', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestAccount.limit;
    for (let i = 0; i < limit; i++) expect(await request()).toBe('queued');
    const activeCode = lastCode();
    expect(await request()).toBe('rate_limited');
    expect(ctx.mailer.sent).toHaveLength(limit);
    // 上限を超えた要求は既存のコードに触れない(第三者が有効なコードを無効にし続けられない)
    expect(await confirm(activeCode)).toEqual({ ok: true });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 61 * 60 * 1000);
    expect(await request()).toBe('queued');
  });

  it('発行要求のアカウント単位の上限は主・サブのメールで同じ枠(スタッフ単位)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestAccount.limit;
    for (let i = 0; i < limit; i++) {
      expect(await request(i % 2 ? 'hanako@cutest.biz' : 'hanako@gmail.com')).toBe('queued');
    }
    expect(await request('hanako@cutest.biz')).toBe('rate_limited');
    expect(await request('hanako@gmail.com')).toBe('rate_limited');
  });

  it('発行要求はアカウント単位の1日の上限も設ける', async () => {
    const day = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestAccountDay.limit;
    const hour = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestAccount.limit;
    let sent = 0;
    while (sent < day) {
      for (let i = 0; i < hour && sent < day; i++, sent++) expect(await request()).toBe('queued');
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 61 * 60 * 1000);
    }
    expect(await request()).toBe('rate_limited');
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      action: 'auth.password_reset.request_rejected',
      actorStaffId: staffId,
      details: { reason: 'rate_limited', scope: 'account_day' },
    });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 24 * 60 * 60 * 1000);
    expect(await request()).toBe('queued');
  });

  it('発行要求のアカウント単位の上限は、存在しないアカウントにも同じように数える(列挙防止)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestAccount.limit;
    for (let i = 0; i < limit; i++) expect(await request('nobody@example.com')).toBe('rejected');
    expect(await request('nobody@example.com')).toBe('rate_limited');
  });

  it('outbox の処理の起動の依頼は、受け付け・アカウントが無い・アカウント単位の上限のどれでも1回(応答時間を揃える)', async () => {
    const notified: string[] = [];
    let current = '';
    const outboxDrain = { notify: async () => void notified.push(current) };
    const deps = {
      ...ctx.deps,
      outboxDrain,
      uow: withOutboxDrainTrigger(ctx.deps.uow, outboxDrain),
    };
    const requestAs = (email: string) => {
      current = email;
      return requestPasswordReset(deps, { tenantSlug: 'test-tenant', email, meta: { ip: '203.0.113.9' } });
    };
    expect((await requestAs('hanako@gmail.com')).status).toBe('queued');
    expect((await requestAs('nobody@example.com')).status).toBe('rejected');
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestAccount.limit;
    for (let i = 1; i < limit; i++) await requestAs('nobody@example.com');
    expect((await requestAs('nobody@example.com')).status).toBe('rate_limited');
    expect(notified).toEqual(['hanako@gmail.com', ...Array(limit + 1).fill('nobody@example.com')]);
  });

  it('発行要求は送信元IP単位でも上限を設け、超えたら ip_rate_limited(APIは429)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestIp.limit;
    for (let i = 0; i < limit; i++) await request(`user${i}@example.com`, 'test-tenant', '198.51.100.7');
    const outcome = await requestPasswordReset(ctx.deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@gmail.com',
      meta: { ip: '198.51.100.7' },
    });
    expect(outcome.status).toBe('ip_rate_limited');
    expect(await request('hanako@gmail.com', 'test-tenant', '198.51.100.8')).toBe('queued');
  });

  it('送信元IP単位の上限は IPv6 なら /64 ごと', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestIp.limit;
    for (let i = 0; i < limit; i++) {
      await request(`user${i}@example.com`, 'test-tenant', `2001:db8:7:7::${(i + 1).toString(16)}`);
    }
    const outcome = await requestPasswordReset(ctx.deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@gmail.com',
      meta: { ip: '2001:db8:7:7:abcd::9' },
    });
    expect(outcome.status).toBe('ip_rate_limited');
    expect(await request('hanako@gmail.com', 'test-tenant', '2001:db8:7:8::1')).toBe('queued');
  });

  it('確認はアカウント単位の上限を超えると rate_limited(コードを発行し直しながらの総当たり対策)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetConfirmAccount.limit;
    for (let i = 0; i < limit; i++) await confirm('00000000');
    expect(await confirm('00000000')).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('確認のアカウント単位の上限は主・サブのメールで同じ枠(スタッフ単位)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetConfirmAccount.limit;
    for (let i = 0; i < limit; i++) {
      await confirm('00000000', 'brand-new-pass', i % 2 ? 'hanako@cutest.biz' : 'hanako@gmail.com');
    }
    expect(await confirm('00000000', 'brand-new-pass', 'hanako@cutest.biz')).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
    expect(await confirm('00000000', 'brand-new-pass', 'hanako@gmail.com')).toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
  });

  it('確認はアカウント単位の1日の上限も設ける(1時間の窓をまたいでも1日30回まで)', async () => {
    const day = DEFAULT_RATE_LIMIT_POLICY.passwordResetConfirmAccountDay.limit;
    const hour = DEFAULT_RATE_LIMIT_POLICY.passwordResetConfirmAccount.limit;
    let tried = 0;
    while (tried < day) {
      for (let i = 0; i < hour && tried < day; i++, tried++) {
        expect((await confirm('00000000')).ok).toBe(false);
      }
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 61 * 60 * 1000);
    }
    expect(await confirm('00000000')).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect(ctx.appLog.entries.at(-1)?.details).toMatchObject({
      reason: 'rate_limited',
      scope: 'account_day',
    });
  });

  it('回数制限を通った確認は、アカウントが無い・退職者でも新しいパスワードのハッシュを作る(応答時間をそろえる)', async () => {
    await request();
    const before = ctx.passwordHasher.hashes;
    await confirm('00000000');
    expect(ctx.passwordHasher.hashes).toBe(before + 1);
    await confirm('00000000', 'brand-new-pass', 'nobody@example.com');
    expect(ctx.passwordHasher.hashes).toBe(before + 2);
    ctx.setRetiredOn(staffId, '2026-01-01');
    await confirm('00000000');
    expect(ctx.passwordHasher.hashes).toBe(before + 3);
    await confirmPasswordReset(ctx.deps, {
      tenantSlug: 'no-such',
      email: 'hanako@gmail.com',
      code: '00000000',
      newPassword: 'brand-new-pass',
    });
    expect(ctx.passwordHasher.hashes).toBe(before + 4);
  });

  it('メール送信に失敗したらワーカーが例外にし(outboxが再試行する)、コードは送信待ちのまま残る', async () => {
    ctx.mailer.fail = true;
    await requestPasswordReset(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@gmail.com' });
    expect(await ctx.drain()).toMatchObject({ retried: 1 });
    expect(ctx.data().outbox[0]?.lastError).toMatch(/SMTP/);
    expect(ctx.data().resetCodes[0]?.mailCode).not.toBeNull();
  });

  it('期限切れ・使用済みのコードのメールは送らない', async () => {
    await requestPasswordReset(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@gmail.com' });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * 60 * 1000);
    await ctx.drain();
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(ctx.data().resetCodes[0]?.mailCode).toBeNull();
  });

  it('未登録アカウントの確認も「無効な認証コード」と同じ結果(列挙防止)', async () => {
    expect(await confirm('12345678', 'brand-new-pass', 'nobody@example.com')).toEqual({
      ok: false,
      reason: 'invalid_code',
    });
  });

  it('移行のあいだは6桁のコードの入力も受け付ける(照合は桁数によらずハッシュで行う)', async () => {
    await request();
    expect(await confirm('123456')).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('短すぎる新パスワードは拒否する', async () => {
    await request();
    expect(await confirm(lastCode(), 'short')).toEqual({
      ok: false,
      reason: 'weak_password',
      violation: 'too_short',
    });
  });
});

describe('パスワード設定の案内のメール', () => {
  it('法人ID と、画面の URL があれば法人IDつきのログイン画面の URL を書く', () => {
    const mail = buildPasswordResetMail('a@example.com', '12345678', 'setup_guide', {
      tenantSlug: 'cutest',
      appPublicUrl: 'https://app.example.jp/',
    });
    expect(mail.text).toContain('ログイン画面: https://app.example.jp/?t=cutest');
    expect(mail.text).toContain('法人ID(事業所ID): cutest');
    expect(mail.text).toContain('コード: 12345678');
    const withoutUrl = buildPasswordResetMail('a@example.com', '12345678', 'setup_guide', {
      tenantSlug: 'cutest',
    });
    expect(withoutUrl.text).not.toContain('ログイン画面:');
  });
});
