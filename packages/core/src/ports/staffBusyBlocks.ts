import type { InstantRange } from './googleCalendar';

/** Googleカレンダー由来のbusy時間帯1件。 */
export interface BusyBlockInput {
  period: { start: Date; end: Date };
  externalEventId?: string | null;
}

/**
 * staff_busy_blocks への書き込みポート(マッチング用のbusyキャッシュ、doc/10)。
 * 実装は packages/db の DrizzleStaffBusyBlockRepository。
 */
export interface StaffBusyBlockStorePort {
  /** window に重なる source の既存行を消し、blocks で置き換える。 */
  replaceInWindow(
    tenantId: string,
    staffId: string,
    source: 'google_calendar',
    window: InstantRange,
    blocks: BusyBlockInput[],
  ): Promise<unknown>;
}
