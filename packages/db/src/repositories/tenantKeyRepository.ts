import type { TenantKeyRecord, TenantKeyRepositoryPort } from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { tenantKeys } from '../schema';

type TenantKeyRow = typeof tenantKeys.$inferSelect;

function toRecord(row: TenantKeyRow): TenantKeyRecord {
  return {
    tenantId: row.tenantId,
    dekVersion: row.dekVersion,
    wrappedDek: row.wrappedDek,
    kekVersion: row.kekVersion,
    revokedAt: row.revokedAt,
  };
}

export class DrizzleTenantKeyRepository implements TenantKeyRepositoryPort {
  constructor(private readonly db: Database) {}

  async find(tenantId: string): Promise<TenantKeyRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(tenantKeys).where(eq(tenantKeys.tenantId, tenantId)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async create(tenantId: string, wrappedDek: string, kekVersion: number): Promise<TenantKeyRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .insert(tenantKeys)
        .values({ tenantId, wrappedDek, kekVersion })
        // 複数リクエストが同時に「まだDEKが無い」と判断してcreateを競合実行した場合、
        // 後勝ちで上書きせず先に作られた行を採用する(DEKを2種類生成して片方が孤立する事故を防ぐ)。
        .onConflictDoNothing({ target: tenantKeys.tenantId })
        .returning();
      const row = rows[0];
      if (row) return toRecord(row);
      // onConflictDoNothingで挿入されなかった=既に他のリクエストが先に作成済み。
      // 同じtx内で読み直す(新たに接続を取り直さない)。
      const existingRows = await tx
        .select()
        .from(tenantKeys)
        .where(eq(tenantKeys.tenantId, tenantId))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) throw new Error(`テナント鍵の作成に失敗しました: tenantId=${tenantId}`);
      return toRecord(existing);
    });
  }

  async updateWrappedDek(tenantId: string, wrappedDek: string, kekVersion: number): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(tenantKeys)
        .set({ wrappedDek, kekVersion, updatedAt: new Date() })
        .where(eq(tenantKeys.tenantId, tenantId));
    });
  }

  async revoke(tenantId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx.update(tenantKeys).set({ revokedAt: new Date() }).where(eq(tenantKeys.tenantId, tenantId));
    });
  }
}
