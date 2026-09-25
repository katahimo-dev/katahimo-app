import { describe, expect, it } from 'vitest';
import type { PlatformMaintenancePort } from '../ports/maintenance';
import { runMaintenance } from './maintenance';
import { provisionTenant } from './tenantProvisioning';
import { createTestContext } from './testContext';
import { FakeKmsPort, FakeTenantProvisioning } from './testDoubles';

const platform: PlatformMaintenancePort = {
  ensureAppLogPartitions: async () => 1,
  dropAppLogPartitions: async () => 0,
  purgeRateLimitBuckets: async () => 0,
};

describe('runMaintenance', () => {
  it('どこからも参照されないファイルを置き場と DB の両方から消す(登録済みの領収書の画像は残す)', async () => {
    const ctx = createTestContext();
    await ctx.storage.put(`${ctx.tenantId}/receipts/orphan.jpg`, 'image/jpeg', new Uint8Array([1]));
    await ctx.uow.run(ctx.tenantId, (r) =>
      r.storedFiles.insert({
        id: '00000000-0000-7000-8000-0000000000f1',
        storageKey: `${ctx.tenantId}/receipts/orphan.jpg`,
        contentType: 'image/jpeg',
        byteSize: 1,
        sha256: new Uint8Array(32),
        purpose: 'receipt_image',
        createdBy: null,
      }),
    );
    const summary = await runMaintenance({ ...ctx.deps, platform, appLogRetentionMonths: 13 });
    expect(summary.partitionsCreated).toBe(1);
    expect(summary.tenants[0]).toMatchObject({ tenantId: ctx.tenantId, filesDeleted: 1 });
    expect(ctx.storage.files.size).toBe(0);
    expect(ctx.data().files).toHaveLength(0);
    expect(ctx.appLog.byAction('maintenance.retention.done')).toHaveLength(1);
  });
});

describe('provisionTenant', () => {
  it('DEK を作ってラップし、同じ slug の2回目は既存を返す', async () => {
    const ctx = createTestContext();
    const provisioning = new FakeTenantProvisioning(ctx.db);
    const deps = { tenants: ctx.deps.tenants, provisioning, kms: new FakeKmsPort() };
    const first = await provisionTenant(deps, { slug: 'Demo-1', name: 'デモ' });
    expect(first).toMatchObject({ created: true, tenant: { slug: 'demo-1', timezone: 'Asia/Tokyo' } });
    expect(provisioning.provisioned[0]?.kekKeyName).toBe('fake');
    expect((await provisionTenant(deps, { slug: 'demo-1', name: 'デモ' })).created).toBe(false);
    await expect(provisionTenant(deps, { slug: '不正', name: 'x' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
