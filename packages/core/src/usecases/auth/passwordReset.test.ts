import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_RATE_LIMIT_POLICY } from '../rateLimits';
import { login } from './login';
import { confirmPasswordReset, RESET_CODE_MAX_ATTEMPTS, requestPasswordReset } from './passwordReset';
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
  const lastCode = () => /コード: (\d{6})/.exec(ctx.mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
  const confirm = (code: string, newPassword = 'brand-new-pass', email = 'hanako@gmail.com') =>
    confirmPasswordReset(ctx.deps, {
      tenantSlug: 'test-tenant',
      email,
      code,
      newPassword,
      meta: { ip: '203.0.113.1' },
    });
  const wrongCodeFor = (code: string) => (code === '123456' ? '654321' : '123456');

  it('6桁のコードをGAS版と同じ文面でメール送信し(ワーカー経由)、送信後はDBにハッシュだけが残る', async () => {
    const outcome = await requestPasswordReset(ctx.deps, {
      tenantSlug: 'test-tenant',
      email: 'hanako@gmail.com',
    });
    expect(outcome).toEqual({ status: 'queued' });
    // リクエストの中では送らず、outboxに積むだけ(応答時間からアカウントの有無が分からないように)
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(ctx.data().outbox.map((j) => j.topic)).toEqual(['mail.password_reset']);
    expect(ctx.data().resetCodes[0]?.mailCodeEnc).not.toBeNull();
    await ctx.drain();
    const mail = ctx.mailer.sent[0];
    expect(mail?.to).toBe('hanako@gmail.com');
    expect(mail?.subject).toBe('【保育日報】パスワード再設定認証コード');
    expect(mail?.text).toMatch(
      /^パスワード再設定のリクエストを受け付けました。\n以下の認証コードを入力してください。\n\nコード: \d{6}\n有効期限: 30分$/,
    );
    const row = ctx.data().resetCodes[0];
    expect(row?.codeHash).not.toContain(lastCode());
    expect(row?.mailCodeEnc).toBeNull();
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

  it('発行要求のアカウント単位の上限は、存在しないアカウントにも同じように数える(列挙防止)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetRequestAccount.limit;
    for (let i = 0; i < limit; i++) expect(await request('nobody@example.com')).toBe('rejected');
    expect(await request('nobody@example.com')).toBe('rate_limited');
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

  it('確認はアカウント単位の上限を超えると rate_limited(コードを発行し直しながらの総当たり対策)', async () => {
    const limit = DEFAULT_RATE_LIMIT_POLICY.passwordResetConfirmAccount.limit;
    for (let i = 0; i < limit; i++) await confirm('000000');
    expect(await confirm('000000')).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('メール送信に失敗したらワーカーが例外にし(outboxが再試行する)、コードは送信待ちのまま残る', async () => {
    ctx.mailer.fail = true;
    await requestPasswordReset(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@gmail.com' });
    expect(await ctx.drain()).toMatchObject({ retried: 1 });
    expect(ctx.data().outbox[0]?.lastError).toMatch(/SMTP/);
    expect(ctx.data().resetCodes[0]?.mailCodeEnc).not.toBeNull();
  });

  it('期限切れ・使用済みのコードのメールは送らない', async () => {
    await requestPasswordReset(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@gmail.com' });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * 60 * 1000);
    await ctx.drain();
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(ctx.data().resetCodes[0]?.mailCodeEnc).toBeNull();
  });

  it('未登録アカウントの確認も「無効な認証コード」と同じ結果(列挙防止)', async () => {
    expect(await confirm('123456', 'brand-new-pass', 'nobody@example.com')).toEqual({
      ok: false,
      reason: 'invalid_code',
    });
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
