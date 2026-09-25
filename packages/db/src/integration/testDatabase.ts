import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { createDatabase, withTenant } from '../client';
import { DrizzleStaffRepository, DrizzleTenantRepository } from '../repositories';

/**
 * 実DBを使う結合テストの準備(packages/db/src/integration/*.test.ts)。
 *
 * DATABASE_URL(アプリロール katahimo_app、マイグレーション適用済み)が設定されているときだけ動き、
 * 無ければテストごとスキップする(`pnpm test` は既定でDB不要のまま)。CI は PostgreSQL サービスに
 * マイグレーションを流してから DATABASE_URL / MIGRATION_DATABASE_URL を渡して実行する。
 * ローカルでは次のように実行する(開発DBにテスト用のテナントを作り、終了時に消す):
 *
 *   DATABASE_URL=postgres://katahimo_app:katahimo_app@localhost:5432/katahimo_dev \
 *   MIGRATION_DATABASE_URL=postgres://katahimo:katahimo@localhost:5432/katahimo_dev \
 *   pnpm vitest run packages/db/src/integration
 *
 * 後片付け(テナントの削除)はアプリロールに権限が無い(0003 で REVOKE)ため、MIGRATION_DATABASE_URL
 * (所有者)がある場合だけ行う。
 */
export const integrationDatabaseUrl = process.env.DATABASE_URL;

export interface TestTenant {
  db: Database;
  tenantId: string;
  staffId: string;
  cleanup(): Promise<void>;
}

/** テスト専用のテナントとスタッフ1人を作る。 */
export async function createTestTenant(url: string): Promise<TestTenant> {
  const db = createDatabase(url);
  const tenant = await new DrizzleTenantRepository(db).create({
    name: '結合テスト',
    slug: `itest-${randomUUID()}`,
  });
  const staff = await new DrizzleStaffRepository(db).create({
    tenantId: tenant.id,
    name: '結合 テスト',
    email: `itest-${randomUUID()}@example.com`,
    isAdmin: false,
  });
  return {
    db,
    tenantId: tenant.id,
    staffId: staff.id,
    async cleanup() {
      const ownerUrl = process.env.MIGRATION_DATABASE_URL;
      if (ownerUrl) {
        const owner = createDatabase(ownerUrl);
        await withTenant(owner, tenant.id, async (tx) => {
          for (const table of [
            'password_reset_codes',
            'sessions',
            'outbox_jobs',
            'app_logs',
            'staff',
            'tenant_keys',
          ]) {
            await tx.execute(sql.raw(`DELETE FROM "${table}" WHERE tenant_id = '${tenant.id}'`));
          }
          await tx.execute(sql`DELETE FROM tenants WHERE id = ${tenant.id}`);
        });
        await owner.$client.end();
      }
      await db.$client.end();
    },
  };
}
