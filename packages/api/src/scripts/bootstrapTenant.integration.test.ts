import { randomBytes } from 'node:crypto';
import { normalizeEmailForIndex } from '@katahimo/core/domain';
import { FakeKmsPort } from '@katahimo/core/test-utils';
import { bootstrapTenant } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, DrizzleUnitOfWork } from '@katahimo/db';
import {
  DrizzleAppLogRepository,
  DrizzleTenantDirectory,
  DrizzleTenantProvisioning,
} from '@katahimo/db/repositories';
import { afterAll, describe, expect, it } from 'vitest';
import { argon2PasswordHasher } from '../authAdapters';

/**
 * `tenant:create`(scripts/createTenant.ts)と同じ組み立てで、実際の DB にテナントと最初の管理者を作る。
 * テナントは所有者の接続(MIGRATION_DATABASE_URL)の platform.provision_tenant()、管理者はアプリの接続(RLS の中)。
 */
const appDb = createDatabase(process.env.DATABASE_URL ?? '', { max: 2, onnotice: () => {} });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

const deps = {
  uow: new DrizzleUnitOfWork(appDb),
  passwordHasher: argon2PasswordHasher,
  appLog: new DrizzleAppLogRepository(appDb),
  tenants: new DrizzleTenantDirectory(ownerDb),
  provisioning: new DrizzleTenantProvisioning(ownerDb),
  kms: new FakeKmsPort(),
};

describe('bootstrapTenant(実DB)', () => {
  it('テナント・鍵・設定と管理者を作り、2回目は何もしない', async () => {
    const slug = `boot-${randomBytes(4).toString('hex')}`;
    const request = {
      slug,
      name: `初期化の試験 ${slug}`,
      admin: { email: `admin@${slug}.example.com`, name: '管理者 花子', initialPassword: 'initial-pass-1' },
    };
    const first = await bootstrapTenant(deps, request);
    expect(first).toMatchObject({ tenantCreated: true, tenant: { slug, status: 'active' } });

    const admin = await deps.uow.run(first.tenant.id, async (r) => ({
      staff: await r.staff.findByLoginEmail(normalizeEmailForIndex(request.admin.email)),
      settings: await r.settings.get(),
    }));
    expect(admin.staff).toMatchObject({ id: first.admin.staffId, role: 'admin', displayName: '管理者 花子' });
    expect(admin.settings.customerDataVersion).toBeDefined();

    const second = await bootstrapTenant(deps, request);
    expect(second).toMatchObject({
      tenantCreated: false,
      tenant: { id: first.tenant.id },
      admin: { staffId: first.admin.staffId, created: false },
    });
  });
});
