import type { AttendanceRowData } from './types';

export type ScheduleEventType = 'CUSTOMER APPOINTMENT' | 'OFFICE WORK';

export interface ScheduleEvent {
  date: string;
  slotKey: 'slot1' | 'slot2' | 'slot3' | 'office1' | 'office2';
  title: string;
  eventType: ScheduleEventType;
  start: string;
  end: string;
}

/**
 * 出勤簿1日分のrowData(入力列)を、週間予定UI表示用のイベント配列に変換する。
 * 始業・終業が両方入力されているスロットのみイベント化する。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の buildScheduleEventsFromRowData_。
 * 実際のGoogleカレンダーからではなく、出勤簿(このアプリではattendance_days)の記録内容を
 * そのままカレンダー風に色分け表示しているだけ、という点がGAS版の設計のポイント
 * (「カレンダーから取得」ボタンで初めてGoogleカレンダー側の内容を取り込む、閲覧とは別の操作)。
 * そのためGoogle Calendar連携(Phase 5)が無くても、この週間表示自体は動く。
 */
export function buildScheduleEventsFromRowData(dateStr: string, rowData: AttendanceRowData): ScheduleEvent[] {
  const slotDefs: Array<{
    slotKey: ScheduleEvent['slotKey'];
    name: string | undefined;
    start: string | undefined;
    end: string | undefined;
    eventType: ScheduleEventType;
  }> = [
    {
      slotKey: 'slot1',
      name: rowData.C,
      start: rowData.D,
      end: rowData.E,
      eventType: 'CUSTOMER APPOINTMENT',
    },
    {
      slotKey: 'slot2',
      name: rowData.L,
      start: rowData.M,
      end: rowData.N,
      eventType: 'CUSTOMER APPOINTMENT',
    },
    {
      slotKey: 'slot3',
      name: rowData.U,
      start: rowData.V,
      end: rowData.W,
      eventType: 'CUSTOMER APPOINTMENT',
    },
    { slotKey: 'office1', name: rowData.X, start: rowData.Y, end: rowData.Z, eventType: 'OFFICE WORK' },
    { slotKey: 'office2', name: rowData.AA, start: rowData.AB, end: rowData.AC, eventType: 'OFFICE WORK' },
  ];

  return slotDefs
    .filter((slot) => slot.start && slot.end)
    .map((slot) => ({
      date: dateStr,
      slotKey: slot.slotKey,
      title: slot.name || '',
      eventType: slot.eventType,
      start: slot.start as string,
      end: slot.end as string,
    }));
}
