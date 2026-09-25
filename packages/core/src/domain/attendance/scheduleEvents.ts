import { ATTENDANCE_SLOTS, type AttendanceSlotKey } from './sheetLayout';
import type { AttendanceRowData } from './types';

export type ScheduleEventType = 'CUSTOMER APPOINTMENT' | 'OFFICE WORK';

export interface ScheduleEvent {
  date: string;
  slotKey: AttendanceSlotKey;
  title: string;
  eventType: ScheduleEventType;
  start: string;
  end: string;
}

/**
 * 出勤簿1日分のrowDataを、週間予定UI用のイベント配列(訪問#1〜#3・事務作業#1〜#2)に変換する。
 * 開始・終了が両方入力されている時間帯だけをイベント化する。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の buildScheduleEventsFromRowData_。
 * Googleカレンダーではなく出勤簿の記録内容をそのままカレンダー風に表示するための変換
 * (カレンダーの内容を取り込むのは別操作の「カレンダーから反映」)。
 */
export function buildScheduleEventsFromRowData(dateStr: string, rowData: AttendanceRowData): ScheduleEvent[] {
  return ATTENDANCE_SLOTS.flatMap((slot) => {
    const start = rowData[slot.start];
    const end = rowData[slot.end];
    if (!start || !end) return [];
    return [
      {
        date: dateStr,
        slotKey: slot.key,
        title: rowData[slot.title] || '',
        eventType: slot.kind === 'visit' ? 'CUSTOMER APPOINTMENT' : 'OFFICE WORK',
        start,
        end,
      },
    ];
  });
}
