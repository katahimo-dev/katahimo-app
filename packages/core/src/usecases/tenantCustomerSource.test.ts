import { describe, expect, it } from 'vitest';
import { updateTenantCustomerImportSettings } from './tenantCustomerSource';
import { createTestContext } from './testContext';
import { FakeTenantCustomerImportSettingsStore } from './testDoubles';

describe('テナントの顧客データの取込元(運用担当者)', () => {
  const setup = () => {
    const ctx = createTestContext();
    const deps = { ...ctx.deps, customerImportSettings: new FakeTenantCustomerImportSettingsStore(ctx.db) };
    return { ctx, deps };
  };

  it('Drive のフォルダを設定・表示・解除し、変えたら SECURITY を残す(フォルダID は残さない)', async () => {
    const { ctx, deps } = setup();
    expect(await updateTenantCustomerImportSettings(deps, 'test-tenant', { kind: 'show' })).toMatchObject({
      settings: null,
    });
    const set = await updateTenantCustomerImportSettings(deps, 'Test-Tenant', {
      kind: 'drive_folder',
      driveFolderId: ' 1AbCdEfGhIjKlMnOpQrStUvWxYz_-012 ',
    });
    expect(set.settings).toEqual({
      provider: 'reserva_csv',
      driveFolderId: '1AbCdEfGhIjKlMnOpQrStUvWxYz_-012',
    });
    // 取込のジョブは UoW から同じ設定を読む
    expect(await ctx.uow.run(ctx.tenantId, (r) => r.customerImportSettings())).toEqual(set.settings);
    expect(ctx.appLog.byAction('tenant.customer_import_settings.updated').at(-1)).toMatchObject({
      level: 'SECURITY',
      actorType: 'operator',
      details: { configured: true, provider: 'reserva_csv' },
    });
    expect(JSON.stringify(ctx.appLog.entries)).not.toContain('1AbCdEf');

    const cleared = await updateTenantCustomerImportSettings(deps, 'test-tenant', { kind: 'clear' });
    expect(cleared.settings).toBeNull();
    expect(await ctx.uow.run(ctx.tenantId, (r) => r.customerImportSettings())).toBeNull();
  });

  it('形の誤ったフォルダID・無いテナントは 400 で何も変えない', async () => {
    const { ctx, deps } = setup();
    await expect(
      updateTenantCustomerImportSettings(deps, 'test-tenant', {
        kind: 'drive_folder',
        driveFolderId: "x' or name contains '",
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      updateTenantCustomerImportSettings(deps, 'no-such', { kind: 'clear' }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'tenant_not_found' });
    expect(ctx.db.customerImportSettings.size).toBe(0);
    expect(ctx.appLog.byAction('tenant.customer_import_settings.updated')).toEqual([]);
  });

  it('別のテナントが取込元にしているフォルダは設定しない(同じテナントに設定し直すのはよい)', async () => {
    const { ctx, deps } = setup();
    const other = ctx.db.addTenant({ slug: 'other-tenant' });
    const folder = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-012';
    await updateTenantCustomerImportSettings(deps, 'other-tenant', {
      kind: 'drive_folder',
      driveFolderId: folder,
    });
    await expect(
      updateTenantCustomerImportSettings(deps, 'test-tenant', {
        kind: 'drive_folder',
        driveFolderId: folder,
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      reason: 'folder_in_use',
      message: expect.stringContaining('other-tenant'),
    });
    expect(ctx.db.customerImportSettings.has(ctx.tenantId)).toBe(false);
    // 同じテナントに同じフォルダを設定し直すのはよい。別のテナントの設定を外せば設定できる
    await updateTenantCustomerImportSettings(deps, 'other-tenant', {
      kind: 'drive_folder',
      driveFolderId: folder,
    });
    await updateTenantCustomerImportSettings(deps, 'other-tenant', { kind: 'clear' });
    const set = await updateTenantCustomerImportSettings(deps, 'test-tenant', {
      kind: 'drive_folder',
      driveFolderId: folder,
    });
    expect(set.settings?.driveFolderId).toBe(folder);
    expect(ctx.db.customerImportSettings.has(other.id)).toBe(false);
  });
});
