import { FakeAppLogPort, FakeCryptoPort, FakePasswordHasherPort } from '@katahimo/core/test-utils';
import {
  confirmPasswordReset,
  DEFAULT_RATE_LIMIT_POLICY,
  requestPasswordReset,
} from '@katahimo/core/usecases';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DrizzleOutboxRepository,
  DrizzlePasswordResetCodeRepository,
  DrizzleRateLimiter,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantRepository,
} from '../repositories';
import type { TestTenant } from './testDatabase';
import { createTestTenant, integrationDatabaseUrl } from './testDatabase';

/**
 * 再現手順そのもの(誤ったコードの確認を並列に大量に送った後、正しいコードを送る)を実DBで確かめる。
 * 並列の要求で上限を超えて試せないこと・上限に達したコードは正しいコードでも通らないこと。
 */
describe.skipIf(!integrationDatabaseUrl)('実DB: パスワード再設定の並列の総当たり', () => {
  let t: TestTenant;
  let email: string;
  const crypto = new FakeCryptoPort();

  beforeAll(async () => {
    t = await createTestTenant(integrationDatabaseUrl as string);
    email = (await new DrizzleStaffRepository(t.db).findById(t.tenantId, t.staffId))?.email ?? '';
  });
  afterAll(async () => {
    await t?.cleanup();
  });

  const deps = () => ({
    tenants: new DrizzleTenantRepository(t.db),
    staff: new DrizzleStaffRepository(t.db),
    sessions: new DrizzleSessionRepository(t.db),
    passwordHasher: new FakePasswordHasherPort(),
    appLog: new FakeAppLogPort(),
    passwordResetCodes: new DrizzlePasswordResetCodeRepository(t.db),
    crypto,
    mailOutbox: new DrizzleOutboxRepository(t.db),
    rateLimiter: new DrizzleRateLimiter(t.db, 'itest-secret'),
    // 回数制限ではなくコードの試行回数の上限を確かめるため、IP・アカウント単位の上限は十分大きくする
    rateLimits: {
      ...DEFAULT_RATE_LIMIT_POLICY,
      passwordResetConfirmAccount: { ...DEFAULT_RATE_LIMIT_POLICY.passwordResetConfirmAccount, limit: 1000 },
      passwordResetConfirmIp: { ...DEFAULT_RATE_LIMIT_POLICY.passwordResetConfirmIp, limit: 1000 },
    },
    resetCodeSecret: 'itest-reset-secret',
  });

  it('誤ったコードの並列40件の後は、正しいコードでも再設定できない', async () => {
    const d = deps();
    const tenantSlug = (await d.tenants.findById(t.tenantId))?.slug ?? '';
    expect(await requestPasswordReset(d, { tenantSlug, email })).toEqual({ status: 'queued' });
    const row = await d.passwordResetCodes.findLatestUnused(t.tenantId, t.staffId);
    const code = row?.mailCode
      ? await crypto.decrypt(t.tenantId, row.mailCode, 'password_reset_codes.mail_code')
      : '';
    expect(code).toMatch(/^\d{6}$/);
    const wrong = code === '123456' ? '654321' : '123456';

    const confirm = (value: string) =>
      confirmPasswordReset(d, { tenantSlug, email, code: value, newPassword: 'brand-new-pass-1' });
    const results = await Promise.all(Array.from({ length: 40 }, () => confirm(wrong)));
    expect(results.every((r) => !r.ok)).toBe(true);
    const after = await d.passwordResetCodes.findById(t.tenantId, row?.id ?? '');
    expect(after?.attemptCount).toBe(5);
    expect(after?.usedAt).not.toBeNull();
    expect((await confirm(code)).ok).toBe(false);
  });
});
