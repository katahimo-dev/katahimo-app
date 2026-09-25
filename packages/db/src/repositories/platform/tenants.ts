import type {
  ProvisionTenantInput,
  TenantDataKeyReaderPort,
  TenantDataKeyRecord,
  TenantDirectoryPort,
  TenantProvisioningPort,
  TenantRecord,
} from '@katahimo/core/ports';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { type Database, type Executor, withTenant } from '../../client';
import { tenantDataKeys, tenants } from '../../schema';

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
}

/**
 * テナントの作成(platform.provision_tenant()、SECURITY DEFINER)。実行できるのは所有者のメンバー
 * (katahimo_migrator)だけのため、MIGRATION_DATABASE_URL の接続で使う(運用の CLI・シード・結合テスト)。
 */
export class DrizzleTenantProvisioning implements TenantProvisioningPort {
  constructor(private readonly db: Database) {}

  async provision(input: ProvisionTenantInput): Promise<void> {
    await this.db.execute(
      sql`select platform.provision_tenant(${input.id}::uuid, ${input.slug}, ${input.name}, ${Buffer.from(
        input.wrappedDek,
      )}::bytea, ${input.kekKeyName}, ${input.timezone}, ${input.businessType})`,
    );
  }
}

/** 復号に使える DEK の読み出し(CryptoPort が使う。テナントの RLS の中で読む)。 */
export class DrizzleTenantDataKeyReader implements TenantDataKeyReaderPort {
  constructor(private readonly db: Database) {}

  listUsable(tenantId: string): Promise<TenantDataKeyRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({
          version: tenantDataKeys.version,
          wrappedDek: tenantDataKeys.wrappedDek,
          kekKeyName: tenantDataKeys.kekKeyName,
          state: tenantDataKeys.state,
        })
        .from(tenantDataKeys)
        .where(
          and(
            eq(tenantDataKeys.tenantId, tenantId),
            inArray(tenantDataKeys.state, ['active', 'decrypt_only']),
          ),
        );
      return rows.flatMap((r) =>
        r.wrappedDek && r.state !== 'destroyed'
          ? [{ version: r.version, wrappedDek: r.wrappedDek, kekKeyName: r.kekKeyName, state: r.state }]
          : [],
      );
    });
  }
}
