import { beforeEach, describe, expect, it } from 'vitest';
import { login } from './login';
import {
  confirmPasswordReset,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_REQUEST_LIMIT,
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
        isAdmin: false,
      })
    ).id;
  });

  const request = (email = 'hanako@gmail.com', tenantSlug = 'test-tenant') =>
    requestPasswordReset(ctx.deps, { tenantSlug, email });
  const lastCode = () => /コード: (\d{6})/.exec(ctx.mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
  const confirm = (code: string, newPassword = 'brand-new-pass', email = 'hanako@gmail.com') =>
    confirmPasswordReset(ctx.deps, { tenantSlug: 'test-tenant', email, code, newPassword });

  it('6桁のコードをGAS版と同じ文面でメール送信し、DBにはハッシュだけを保存する', async () => {
    expect(await request()).toBe('sent');
    const mail = ctx.mailer.sent[0];
    expect(mail?.to).toBe('hanako@gmail.com');
    expect(mail?.subject).toBe('【保育日報】パスワード再設定認証コード');
    expect(mail?.text).toMatch(
      /^パスワード再設定のリクエストを受け付けました。\n以下の認証コードを入力してください。\n\nコード: \d{6}\n有効期限: 30分$/,
    );
    const row = ctx.resetCodes.rows[0];
    expect(row?.codeHash).not.toContain(lastCode());
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

  it('未登録のメール・未知のテナント・退職者には送らず、WARNログだけ残す', async () => {
    expect(await request('nobody@example.com')).toBe('rejected');
    expect(await request('hanako@gmail.com', 'no-such')).toBe('rejected');
    ctx.staff.setRetirementDateForTest(ctx.tenantId, staffId, '2026-01-01');
    expect(await request()).toBe('rejected');
    expect(ctx.mailer.sent).toHaveLength(0);
    expect(ctx.appLog.entries.map((e) => [e.level, e.details?.reason])).toEqual([
      ['WARN', 'unknown_login_id'],
      ['WARN', 'tenant_not_found'],
      ['WARN', 'retired'],
    ]);
  });

  it('正しいコードで再設定でき、コードは1回しか使えず、既存セッションは失効する', async () => {
    await login(ctx.deps, { tenantSlug: 'test-tenant', email: 'hanako@gmail.com', password: 'old-password' });
    await request();
    const code = lastCode();
    expect(await confirm(code)).toEqual({ ok: true });
    expect(ctx.sessions.rows).toHaveLength(0);
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

  it(`誤入力が${RESET_CODE_MAX_ATTEMPTS}回に達するとコードは無効になり、正しいコードでも再設定できない`, async () => {
    await request();
    const code = lastCode();
    const wrong = code === '123456' ? '654321' : '123456';
    const results = [];
    for (let i = 0; i < RESET_CODE_MAX_ATTEMPTS; i++) results.push((await confirm(wrong)).ok ? 'ok' : 'ng');
    expect(results).toEqual(Array(RESET_CODE_MAX_ATTEMPTS).fill('ng'));
    expect(await confirm(code)).toEqual({ ok: false, reason: 'invalid_code' });
    expect(
      ctx.appLog.entries.filter((e) => e.action === 'auth.password_reset.failed').at(-2)?.details,
    ).toEqual({
      reason: 'too_many_attempts',
    });
  });

  it(`1時間に${RESET_REQUEST_LIMIT}回を超える発行要求は送信しない`, async () => {
    for (let i = 0; i < RESET_REQUEST_LIMIT; i++) expect(await request()).toBe('sent');
    expect(await request()).toBe('rate_limited');
    expect(ctx.mailer.sent).toHaveLength(RESET_REQUEST_LIMIT);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 61 * 60 * 1000);
    expect(await request()).toBe('sent');
  });

  it('メール送信に失敗した場合はERRORログを残す', async () => {
    ctx.mailer.fail = true;
    expect(await request()).toBe('mail_failed');
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'ERROR',
      action: 'auth.password_reset.mail_failed',
    });
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
