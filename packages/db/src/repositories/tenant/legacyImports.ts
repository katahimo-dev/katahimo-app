import type { LegacyImportRowSource } from '@katahimo/core/domain';
import { conflict, LEGACY_IMPORT_BUSY_MESSAGE, LEGACY_IMPORT_BUSY_REASON } from '@katahimo/core/domain';
import type { LegacyImportedRow, LegacyImportRepository } from '@katahimo/core/ports';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { LOCK_NOT_AVAILABLE, pgErrorOf } from '../../errors';
import { legacyImportedRows } from '../../schema';
import { TenantBound } from './base';

const columns = {
  source: legacyImportedRows.source,
  rowNumber: legacyImportedRows.rowNumber,
  sourceKey: legacyImportedRows.sourceKey,
  careRecordId: legacyImportedRows.careRecordId,
  receiptId: legacyImportedRows.receiptId,
  sourceDigest: legacyImportedRows.sourceDigest,
  syncedRowVersion: legacyImportedRows.syncedRowVersion,
};

/** IN の中に並べるキー・行番号の数の上限(文の大きさを抑える)。 */
const KEYS_PER_QUERY = 1000;

export class DrizzleLegacyImportRepository extends TenantBound implements LegacyImportRepository {
  async lockTenantLegacyImports(): Promise<void> {
    try {
      await this.tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`legacy_import:${this.tenantId}`}, 0))`,
      );
    } catch (error) {
      // 別の取込が lock_timeout より長くロックを持っている(同時に2つ流した)
      if (pgErrorOf(error)?.code === LOCK_NOT_AVAILABLE) {
        throw conflict(LEGACY_IMPORT_BUSY_MESSAGE, undefined, LEGACY_IMPORT_BUSY_REASON);
      }
      throw error;
    }
  }

  findByRowNumbers(
    source: LegacyImportRowSource,
    rowNumbers: readonly number[],
  ): Promise<LegacyImportedRow[]> {
    return this.findIn(source, legacyImportedRows.rowNumber, rowNumbers);
  }

  findBySourceKeys(
    source: LegacyImportRowSource,
    sourceKeys: readonly string[],
  ): Promise<LegacyImportedRow[]> {
    return this.findIn(source, legacyImportedRows.sourceKey, sourceKeys);
  }

  private async findIn<T extends string | number>(
    source: LegacyImportRowSource,
    column: typeof legacyImportedRows.rowNumber | typeof legacyImportedRows.sourceKey,
    values: readonly T[],
  ): Promise<LegacyImportedRow[]> {
    const found: LegacyImportedRow[] = [];
    for (let i = 0; i < values.length; i += KEYS_PER_QUERY) {
      const chunk = values.slice(i, i + KEYS_PER_QUERY);
      found.push(
        ...(await this.tx
          .select(columns)
          .from(legacyImportedRows)
          .where(
            and(
              eq(legacyImportedRows.tenantId, this.tenantId),
              eq(legacyImportedRows.source, source),
              inArray(column, chunk),
            ),
          )),
      );
    }
    return found;
  }

  listBySource(source: LegacyImportRowSource): Promise<LegacyImportedRow[]> {
    return this.tx
      .select(columns)
      .from(legacyImportedRows)
      .where(and(eq(legacyImportedRows.tenantId, this.tenantId), eq(legacyImportedRows.source, source)));
  }

  async save(row: LegacyImportedRow & { importRunId: string }): Promise<void> {
    await this.tx
      .insert(legacyImportedRows)
      .values({ tenantId: this.tenantId, ...row })
      .onConflictDoUpdate({
        target: [legacyImportedRows.tenantId, legacyImportedRows.source, legacyImportedRows.rowNumber],
        set: {
          sourceKey: row.sourceKey,
          sourceDigest: row.sourceDigest,
          syncedRowVersion: row.syncedRowVersion,
          importRunId: row.importRunId,
        },
      });
  }

  async isImportedReceipt(receiptId: string): Promise<boolean> {
    const rows = await this.tx
      .select({ receiptId: legacyImportedRows.receiptId })
      .from(legacyImportedRows)
      .where(and(eq(legacyImportedRows.tenantId, this.tenantId), eq(legacyImportedRows.receiptId, receiptId)))
      .limit(1);
    return rows.length > 0;
  }
}
