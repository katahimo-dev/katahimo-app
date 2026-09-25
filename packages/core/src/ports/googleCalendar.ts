import type { CalendarEvent } from '../domain/schedule/types';

/** 半開区間 [from, to)。 */
export interface InstantRange {
  from: Date;
  to: Date;
}

export interface CalendarEventList {
  /** カレンダーの名前(Google Calendarの summary)。GAS版ではこれがスタッフ名として使われていた。 */
  calendarName: string;
  events: CalendarEvent[];
}

export interface BusyInterval {
  start: Date;
  end: Date;
}

/** カレンダー1つ分の free/busy。読めなかった(共有されていない等)場合は error に理由が入る。 */
export interface CalendarBusyResult {
  busy: BusyInterval[];
  error?: string;
}

/**
 * Google Calendar API(サービスアカウント)の読み取りポート。実装は
 * packages/integrations/src/google-calendar。
 *
 * ports/calendar.ts の CalendarPort(個別予定の作成・更新・削除を含む将来のカレンダー同期用)とは
 * 別に、予定表示・ルート計算とマッチング用free/busyに必要な読み取りだけを持つ。
 */
export interface GoogleCalendarPort {
  /** rangeに一部でも重なる予定(繰り返し予定は展開済み、キャンセル済みは除く)。 */
  listEvents(calendarId: string, range: InstantRange): Promise<CalendarEventList>;
  /** calendarIdごとのbusy時間帯。 */
  freeBusy(calendarIds: string[], range: InstantRange): Promise<Map<string, CalendarBusyResult>>;
}
