import type { InstantRange } from './googleCalendar';

export interface StaffCalendarRecord {
  id: string;
  staffId: string;
  calendarId: string;
  purpose: 'schedule' | 'busy';
}

export interface StaffCalendarRepository {
  listAll(): Promise<StaffCalendarRecord[]>;
  /** スタッフの予定を読むカレンダー(purpose = 'schedule')を設定する(null で外す)。 */
  setScheduleCalendar(staffId: string, calendarId: string | null, newId: string): Promise<void>;
  recordSync(id: string, result: { at: Date; error: string | null }): Promise<void>;
}

export interface BusyBlockInput {
  id: string;
  period: { start: Date; end: Date };
  externalEventId?: string | null;
}

/** 予定あり時間帯のキャッシュ(マッチング用、doc/10)。 */
export interface StaffBusyBlockRepository {
  /** window に重なる source の既存行を消し、blocks で置き換える。 */
  replaceInWindow(
    staffId: string,
    source: 'google_calendar',
    window: InstantRange,
    blocks: BusyBlockInput[],
  ): Promise<void>;
}
