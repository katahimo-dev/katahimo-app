import type {
  ProvisionTenantInput,
  TenantDirectoryPort,
  TenantProvisioningPort,
  TenantRecord,
} from '@katahimo/core/ports';
import { asc, eq, sql } from 'drizzle-orm';
import type { Database, Executor } from '../../client';
import { tenants } from '../../schema';

const tenantColumns = {
  id: tenants.id,
  slug: tenants.slug,
  name: tenants.name,
  status: tenants.status,
  timezone: tenants.timezone,
  businessType: tenants.businessType,
};

export async function findTenantById(db: Executor, id: string): Promise<TenantRecord | null> {
  const rows = await db.select(tenantColumns).from(tenants).where(eq(tenants.id, id));
  return rows[0] ?? null;
}

/** platform.tenants の参照(RLS なし)。 */
export class DrizzleTenantDirectory implements TenantDirectoryPort {
  constructor(private readonly db: Database) {}

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    const rows = await this.db.select(tenantColumns).from(tenants).where(eq(tenants.slug, slug));
    return rows[0] ?? null;
  }

  findById(id: string): Promise<TenantRecord | null> {
    return findTenantById(this.db, id);
  }

  listActive(): Promise<TenantRecord[]> {
    return this.db
      .select(tenantColumns)
      .from(tenants)
      .where(eq(tenants.status, 'active'))
      .orderBy(asc(tenants.slug));
  }

  listAll(): Promise<TenantRecord[]> {
    return this.db.select(tenantColumns).from(tenants).orderBy(asc(tenants.slug));
  }
}

/**
 * テナントの作成(platform.provision_tenant()、SECURITY DEFINER)。実行できるのは所有者のメンバー
 * (katahimo_migrator)だけのため、MIGRATION_DATABASE_URL の接続で使う(運用の CLI・シード・結合テスト)。
 */
export class DrizzleTenantProvisioning implements TenantProvisioningPort {
  constructor(private readonly db: Database) {}

  async provision(input: ProvisionTenantInput): Promise<void> {
    await this.db.execute(
      sql`select platform.provision_tenant(${input.id}::uuid, ${input.slug}, ${input.name}, ${input.timezone}, ${input.businessType})`,
    );
  }
}
