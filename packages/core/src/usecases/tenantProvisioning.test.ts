import { describe, expect, it } from 'vitest';
import { bootstrapTenant } from './tenantProvisioning';
import { createTestContext } from './testContext';
import { FakeKmsPort, FakeTenantProvisioning } from './testDoubles';

function setup() {
  const ctx = createTestContext();
  const deps = {
    ...ctx.deps,
    provisioning: new FakeTenantProvisioning(ctx.db),
    kms: new FakeKmsPort(),
  };
  return { ctx, deps };
}

const request = {
  slug: 'cutest',
  name: '株式会社キューテスト',
  admin: { email: ' Admin@Example.com ', name: '管理者 太郎' },
};

describe('bootstrapTenant', () => {
  it('テナントと、パスワード未設定の最初の管理者を作り、SECURITY の操作ログに残す', async () => {
    const { ctx, deps } = setup();
    const result = await bootstrapTenant(deps, request);

    expect(result).toMatchObject({
      tenantCreated: true,
      tenant: { slug: 'cutest', name: '株式会社キューテスト' },
      admin: { created: true, role: 'admin' },
    });
    const admin = ctx.data(result.tenant.id).staff.find((s) => s.record.id === result.admin.staffId);
    expect(admin?.record).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
      displayName: '管理者 太郎',
    });
    expect(admin?.credentials?.passwordHash ?? null).toBeNull();
    expect(ctx.appLog.actions()).toEqual(['tenant.provisioned', 'staff.admin.bootstrapped']);
    expect(ctx.appLog.entries[1]).toMatchObject({
      tenantId: result.tenant.id,
      level: 'SECURITY',
      actorType: 'system',
      targetStaffId: result.admin.staffId,
      details: { passwordSet: false },
    });
  });

  it('初期パスワードを渡すとそのパスワードでログインできる管理者を作る', async () => {
    const { ctx, deps } = setup();
    const result = await bootstrapTenant(deps, {
      ...request,
      admin: { ...request.admin, initialPassword: 'first-login-pass' },
    });
    const admin = ctx.data(result.tenant.id).staff.find((s) => s.record.id === result.admin.staffId);
    expect(admin?.credentials?.passwordHash).toBeTruthy();
    expect(await ctx.passwordHasher.verify(admin?.credentials?.passwordHash ?? '', 'first-login-pass')).toBe(
      true,
    );
    expect(ctx.appLog.entries.at(-1)?.details).toEqual({ passwordSet: true });
  });

  it('2回目は既存のテナント・管理者を返し、何も作らない(既存のスタッフの権限は変えない)', async () => {
    const { ctx, deps } = setup();
    const first = await bootstrapTenant(deps, request);
    const second = await bootstrapTenant(deps, { ...request, admin: { ...request.admin, name: '別の名前' } });

    expect(second).toMatchObject({
      tenantCreated: false,
      tenant: { id: first.tenant.id },
      admin: { staffId: first.admin.staffId, created: false, role: 'admin' },
    });
    expect(ctx.data(first.tenant.id).staff).toHaveLength(1);
    expect(deps.provisioning.provisioned).toHaveLength(1);
    expect(ctx.appLog.actions()).toEqual(['tenant.provisioned', 'staff.admin.bootstrapped']);
  });

  it('メール・氏名・初期パスワードの誤りは何も作らずに拒否する', async () => {
    const { deps } = setup();
    for (const admin of [
      { email: 'not-an-email', name: '管理者' },
      { email: 'a@example.com', name: '  ' },
      { email: 'a@example.com', name: '管理者', initialPassword: 'short' },
    ]) {
      await expect(bootstrapTenant(deps, { ...request, admin })).rejects.toMatchObject({
        code: 'validation_failed',
      });
    }
    expect(deps.provisioning.provisioned).toHaveLength(0);
  });
});
