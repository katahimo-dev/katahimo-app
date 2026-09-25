import type {
  EncryptedField,
  NewReceiptInput,
  ReceiptRecord,
  ReceiptRepositoryPort,
} from '@katahimo/core/ports';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { receipts } from '../schema';

type ReceiptRow = typeof receipts.$inferSelect;

function encField(ciphertext: string | null, keyVersion: number | null): EncryptedField | null {
  return ciphertext && keyVersion != null ? { ciphertext, keyVersion } : null;
}

function toRecord(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    receiptTimestamp: row.receiptTimestamp,
    amount: encField(row.amountCiphertext, row.amountKeyVersion),
    storeName: encField(row.storeNameCiphertext, row.storeNameKeyVersion),
    handoffText: encField(row.handoffTextCiphertext, row.handoffTextKeyVersion),
    fileKey: row.fileKey,
    contentType: row.contentType,
  };
}

export class DrizzleReceiptRepository implements ReceiptRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewReceiptInput): Promise<ReceiptRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(receipts)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          customerId: input.customerId,
          receiptTimestamp: input.receiptTimestamp,
          dedupeBlindIndex: input.dedupeBlindIndex,
          amountCiphertext: input.amount?.ciphertext ?? null,
          amountKeyVersion: input.amount?.keyVersion ?? null,
          storeNameCiphertext: input.storeName?.ciphertext ?? null,
          storeNameKeyVersion: input.storeName?.keyVersion ?? null,
          handoffTextCiphertext: input.handoffText?.ciphertext ?? null,
          handoffTextKeyVersion: input.handoffText?.keyVersion ?? null,
          fileKey: input.fileKey,
          contentType: input.contentType,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('領収書の保存に失敗しました');
      return toRecord(row);
    });
  }

  async findById(tenantId: string, id: string): Promise<ReceiptRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(receipts).where(eq(receipts.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findExistingDedupeIndexes(tenantId: string, dedupeBlindIndexes: string[]): Promise<Set<string>> {
    if (dedupeBlindIndexes.length === 0) return new Set();
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ dedupeBlindIndex: receipts.dedupeBlindIndex })
        .from(receipts)
        .where(
          and(isNotNull(receipts.dedupeBlindIndex), inArray(receipts.dedupeBlindIndex, dedupeBlindIndexes)),
        );
      return new Set(rows.map((r) => r.dedupeBlindIndex).filter((v): v is string => v !== null));
    });
  }
}
