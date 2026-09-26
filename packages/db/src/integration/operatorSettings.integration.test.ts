import { newId, outboxDedupeKey } from '@katahimo/core/domain';
import { describe, expect, it } from 'vitest';
import {
  DrizzleTenantCustomerImportSettingsStore,
  DrizzleTenantDirectory,
} from '../repositories/platform/tenants';
import { DrizzleUnitOfWork } from '../uow';
import { connect } from './testDb';

/**
 * テナントごとの運用担当者の設定と、ミラーのテナントの限定を実際の DB で確かめる:
 * - 顧客データの取込元(platform.tenants.customer_import_settings)は所有者の接続で書き、アプリ・ワーカーは UoW で読む
 * - UoW はミラーするテナント(GAS_BRIDGE_TENANT)の時だけ mirror.* を積む
 */
const { app, owner, worker, uow, createTenant } = connect();

describe('運用担当者の設定・ミラーのテナント', () => {
  it('顧客データの取込元は所有者の接続で書き、アプリ・ワーカーの UoW から読める(設定の無いテナントは null)', async () => {
    const a = await createTenant('src');
    const b = await createTenant('src');
    const store = new DrizzleTenantCustomerImportSettingsStore(owner);
    await store.set(a, { provider: 'reserva_csv', driveFolderId: '1AbCdEfGhIjKlMnOp' });
    expect(await uow.run(a, (r) => r.customerImportSettings())).toEqual({
      provider: 'reserva_csv',
      driveFolderId: '1AbCdEfGhIjKlMnOp',
    });
    expect(await uow.run(b, (r) => r.customerImportSettings())).toBeNull();
    if (worker) {
      expect(await new DrizzleUnitOfWork(worker).run(a, (r) => r.customerImportSettings())).toMatchObject({
        driveFolderId: '1AbCdEfGhIjKlMnOp',
      });
    }
    await store.set(a, null);
    expect(await store.get(a)).toBeNull();
    // アプリのロールは platform.tenants を書けない(設定を変えられるのは運用担当者だけ)
    await expect(
      new DrizzleTenantCustomerImportSettingsStore(app).set(b, {
        provider: 'reserva_csv',
        driveFolderId: 'x'.repeat(12),
      }),
    ).rejects.toThrow();
  });

  it('UoW はミラーするテナントの時だけ mirror.* を積み、メールはどのテナントでも積む', async () => {
    const mirrored = await createTenant('mir');
    const other = await createTenant('mir');
    const slug = (await new DrizzleTenantDirectory(app).findById(mirrored))?.slug ?? '';
    const policyUow = new DrizzleUnitOfWork(app, {
      outboxPolicy: { mirrorTenantSlug: slug, pushEnabled: false },
    });
    const enqueueAll = (tenantId: string) =>
      policyUow.run(tenantId, async (r) => {
        const id = newId();
        return {
          mirror: await r.outbox.enqueue({
            topic: 'mirror.care_record',
            aggregateType: 'care_record',
            aggregateId: id,
            dedupeKey: outboxDedupeKey('mirror.care_record', id, 1),
          }),
          mail: await r.outbox.enqueue({
            topic: 'mail.password_reset',
            aggregateType: 'password_reset_code',
            aggregateId: id,
            dedupeKey: outboxDedupeKey('mail.password_reset', id, 1),
          }),
          push: await r.outbox.enqueue({
            topic: 'push.test',
            aggregateType: 'staff',
            aggregateId: id,
            dedupeKey: outboxDedupeKey('push.test', id, 1),
          }),
        };
      });
    expect(await enqueueAll(mirrored)).toEqual({ mirror: true, mail: true, push: false });
    expect(await enqueueAll(other)).toEqual({ mirror: false, mail: true, push: false });
  });
});
