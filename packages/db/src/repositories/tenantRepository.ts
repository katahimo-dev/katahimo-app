import type { NewTenantInput, TenantRecord, TenantRepositoryPort } from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { tenants } from '../schema';

function toRecord(row: typeof tenants.$inferSelect): TenantRecord {
  return { id: row.id, name: row.name, slug: row.slug, status: row.status };
}

/** tenantsテーブルはRLS対象外なので、withTenant()を使わず直接dbで問い合わせる。 */
export class DrizzleTenantRepository implements TenantRepositoryPort {
  constructor(private readonly db: Database) {}

  async findBySlug(slug: string): Promise<TenantRecord | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<TenantRecord | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    const row = rows[0];
    return row ? toRecord(row) : null;
  }

  async create(input: NewTenantInput): Promise<TenantRecord> {
    const rows = await this.db.insert(tenants).values({ name: input.name, slug: input.slug }).returning();
    const row = rows[0];
    if (!row) throw new Error('テナントの作成に失敗しました');
    return toRecord(row);
  }

  async listAll(): Promise<TenantRecord[]> {
    const rows = await this.db.select().from(tenants);
    return rows.map(toRecord);
  }

  async listActive(): Promise<TenantRecord[]> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.status, 'active'));
    return rows.map(toRecord);
  }
}
