import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { type BusyBlockSource, calendarSyncStates, staffBusyBlocks, type TimeRange } from '../schema';
import { type InstantRange, overlapsRange } from './_rangeSql';

/**
 * スタッフの予定あり(busy)時間帯キャッシュと、Googleカレンダー同期状態の読み書き(doc/10)。
 * 将来のカレンダー同期ワーカー・マッチングアプリ向けの土台。core側のPortはまだ無いため型は
 * このファイルで定義する。
 */
export interface BusyBlockRecord {
  id: string;
  tenantId: string;
  staffId: string;
  period: TimeRange;
  source: BusyBlockSource;
  externalEventId: string | null;
  syncedAt: Date;
}

export interface BusyBlockInput {
  period: { start: Date; end: Date };
  externalEventId?: string | null;
}

export interface CalendarSyncStateRecord {
  id: string;
  tenantId: string;
  staffId: string;
  calendarId: string;
  syncToken: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
}

function toBusyRecord(row: typeof staffBusyBlocks.$inferSelect): BusyBlockRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    period: row.period,
    source: row.source,
    externalEventId: row.externalEventId,
    syncedAt: row.syncedAt,
  };
}

function toSyncRecord(row: typeof calendarSyncStates.$inferSelect): CalendarSyncStateRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    calendarId: row.calendarId,
    syncToken: row.syncToken,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
  };
}

export class DrizzleStaffBusyBlockRepository {
  constructor(private readonly db: Database) {}

  /** 指定時間帯に重なるbusy時間帯を返す(GiSTインデックス staff_busy_blocks_period_gist_idx が効く)。 */
  async listOverlapping(
    tenantId: string,
    staffIds: string[],
    range: InstantRange,
  ): Promise<BusyBlockRecord[]> {
    if (staffIds.length === 0) return [];
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(staffBusyBlocks)
        .where(and(inArray(staffBusyBlocks.staffId, staffIds), overlapsRange(staffBusyBlocks.period, range)))
        .orderBy(asc(staffBusyBlocks.staffId), sql`lower(${staffBusyBlocks.period})`);
      return rows.map(toBusyRecord);
    });
  }

  /**
   * 同期ウィンドウ(window)内の、指定sourceのbusy時間帯を blocks で丸ごと置き換える。
   * free/busy APIの結果(イベントIDを持たない)をそのまま入れ直す全置換型の同期に使う。
   * ウィンドウに一部でも重なる既存行は削除するため、blocksもウィンドウと重なる全区間を渡すこと。
   */
  async replaceInWindow(
    tenantId: string,
    staffId: string,
    source: BusyBlockSource,
    window: InstantRange,
    blocks: BusyBlockInput[],
  ): Promise<BusyBlockRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(staffBusyBlocks)
        .where(
          and(
            eq(staffBusyBlocks.staffId, staffId),
            eq(staffBusyBlocks.source, source),
            overlapsRange(staffBusyBlocks.period, window),
          ),
        );
      if (blocks.length === 0) return [];
      const syncedAt = new Date();
      const rows = await tx
        .insert(staffBusyBlocks)
        .values(
          blocks.map((b) => ({
            tenantId,
            staffId,
            source,
            period: b.period,
            externalEventId: b.externalEventId ?? null,
            syncedAt,
          })),
        )
        .returning();
      return rows.map(toBusyRecord);
    });
  }

  async findSyncState(
    tenantId: string,
    staffId: string,
    calendarId: string,
  ): Promise<CalendarSyncStateRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(calendarSyncStates)
        .where(and(eq(calendarSyncStates.staffId, staffId), eq(calendarSyncStates.calendarId, calendarId)))
        .limit(1);
      const row = rows[0];
      return row ? toSyncRecord(row) : null;
    });
  }

  /** 同期結果の記録。成功時はlastErrorをnullで渡す。syncTokenはトークン失効時にnullで渡して全件再同期させる。 */
  async saveSyncState(input: {
    tenantId: string;
    staffId: string;
    calendarId: string;
    syncToken: string | null;
    lastSyncedAt: Date | null;
    lastError: string | null;
  }): Promise<CalendarSyncStateRecord> {
    const values = {
      syncToken: input.syncToken,
      lastSyncedAt: input.lastSyncedAt,
      lastError: input.lastError,
    };
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(calendarSyncStates)
        .values({ tenantId: input.tenantId, staffId: input.staffId, calendarId: input.calendarId, ...values })
        .onConflictDoUpdate({
          target: [calendarSyncStates.tenantId, calendarSyncStates.staffId, calendarSyncStates.calendarId],
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('カレンダー同期状態の保存に失敗しました');
      return toSyncRecord(row);
    });
  }
}
