/**
 * カレンダー連携のポート。
 *
 * GAS版は CalendarApp.getAllCalendars() で「デプロイユーザーが見られる全カレンダー」を
 * 横断していたが、サーバー実装には等価なAPIがない。新設計では「どのカレンダーを読むか」を
 * 呼び出し側(スタッフに紐づく calendar_id)が明示する。
 */
export interface CalendarEventInput {
  title: string;
  description: string;
  location: string;
  /** ISO8601(タイムゾーン付き) */
  startsAt: string;
  endsAt: string;
}

export interface ExternalCalendarEvent extends CalendarEventInput {
  /** カレンダー提供元のイベントID。external_ids で内部IDと対応付ける。 */
  externalEventId: string;
  /** イベントが載っていたカレンダーのID(＝どのスタッフの予定か) */
  calendarId: string;
  /** ゲストの表示名(なければメールアドレス) */
  guestNames: string[];
  /** このカレンダーの持ち主がこの予定を辞退しているか */
  declinedByOwner: boolean;
}

export interface CalendarPort {
  /** 指定カレンダーの、指定日(JST)の予定を取得する。 */
  listEventsForDate(calendarId: string, businessDate: string): Promise<ExternalCalendarEvent[]>;
  createEvent(calendarId: string, input: CalendarEventInput): Promise<string>;
  updateEvent(calendarId: string, externalEventId: string, input: CalendarEventInput): Promise<void>;
  deleteEvent(calendarId: string, externalEventId: string): Promise<void>;
}
