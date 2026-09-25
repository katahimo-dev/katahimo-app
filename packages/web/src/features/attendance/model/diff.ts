import type { AttendanceCellChange } from '@katahimo/shared';

/** 「カレンダーと違うところ」の1行(GAS版 openCalendarSyncDiffModal)。 */
export interface DiffRow {
  key: string;
  label: string;
  oldText: string;
  newText: string;
}

const BLANK = '（空欄）';

export function buildDiffRows(changes: readonly AttendanceCellChange[]): DiffRow[] {
  return changes.map((c, i) => ({
    key: `${c.column}-${i}`,
    label: c.label,
    oldText: c.oldValue || BLANK,
    newText: c.newValue || BLANK,
  }));
}

/** 「カレンダーの予定 4件 / 直すところ 2件」 */
export function diffCountText(appointmentCount: number, changeCount: number): string {
  return `カレンダーの予定 ${appointmentCount}件 / 直すところ ${changeCount}件`;
}

/** 違いが無かったときのお知らせ(GAS版 refreshPastScheduleDay) */
export function sameAsCalendarMessage(appointmentCount: number | undefined): string {
  const countText = typeof appointmentCount === 'number' ? `（予定 ${appointmentCount}件）` : '';
  return `出勤簿はカレンダーと同じです${countText}`;
}
