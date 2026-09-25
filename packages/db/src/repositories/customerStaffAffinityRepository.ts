import type { EncryptedField } from '@katahimo/core/ports';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { type AffinitySource, customerStaffAffinities } from '../schema';

/**
 * 顧客×スタッフの相性・NG情報の読み書き(doc/10)。将来のマッチングアプリ向けの土台。
 * core側のPortはまだ無いため型はこのファイルで定義する。
 */
export interface CustomerStaffAffinityRecord {
  id: string;
  tenantId: string;
  customerId: string;
  staffId: string;
  /** -2〜+2(DBのCHECK制約で強制)。 */
  score: number;
  isNg: boolean;
  source: AffinitySource;
  note: EncryptedField | null;
  updatedByStaffId: string | null;
  updatedAt: Date;
}

export interface UpsertAffinityInput {
  tenantId: string;
  customerId: string;
  staffId: string;
  score: number;
  isNg?: boolean;
  source?: AffinitySource;
  note?: EncryptedField | null;
  updatedByStaffId?: string | null;
}

function toRecord(row: typeof customerStaffAffinities.$inferSelect): CustomerStaffAffinityRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    staffId: row.staffId,
    score: row.score,
    isNg: row.isNg,
    source: row.source,
    note:
      row.noteCiphertext && row.noteKeyVersion != null
        ? { ciphertext: row.noteCiphertext, keyVersion: row.noteKeyVersion }
        : null,
    updatedByStaffId: row.updatedByStaffId,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleCustomerStaffAffinityRepository {
  constructor(private readonly db: Database) {}

  /** 指定顧客群の相性情報をまとめて取得する(マッチング対象の予約に含まれる顧客全員分を1クエリで読む用途)。 */
  async listByCustomers(tenantId: string, customerIds: string[]): Promise<CustomerStaffAffinityRecord[]> {
    if (customerIds.length === 0) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customerStaffAffinities)
        .where(inArray(customerStaffAffinities.customerId, customerIds));
      return rows.map(toRecord);
    });
  }

  /** スタッフ側からの逆引き(このスタッフがNG/相性の良い顧客一覧)。 */
  async listByStaff(tenantId: string, staffId: string): Promise<CustomerStaffAffinityRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(customerStaffAffinities)
        .where(eq(customerStaffAffinities.staffId, staffId));
      return rows.map(toRecord);
    });
  }

  /** (顧客, スタッフ)の組に対して1行を作成または上書きする。 */
  async upsert(input: UpsertAffinityInput): Promise<CustomerStaffAffinityRecord> {
    const values = {
      score: input.score,
      isNg: input.isNg ?? false,
      source: input.source ?? 'manual',
      noteCiphertext: input.note?.ciphertext ?? null,
      noteKeyVersion: input.note?.keyVersion ?? null,
      updatedByStaffId: input.updatedByStaffId ?? null,
    } as const;
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(customerStaffAffinities)
        .values({ tenantId: input.tenantId, customerId: input.customerId, staffId: input.staffId, ...values })
        .onConflictDoUpdate({
          target: [
            customerStaffAffinities.tenantId,
            customerStaffAffinities.customerId,
            customerStaffAffinities.staffId,
          ],
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('相性情報の保存に失敗しました');
      return toRecord(row);
    });
  }

  async delete(tenantId: string, customerId: string, staffId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(customerStaffAffinities)
        .where(
          and(
            eq(customerStaffAffinities.customerId, customerId),
            eq(customerStaffAffinities.staffId, staffId),
          ),
        );
    });
  }
}
