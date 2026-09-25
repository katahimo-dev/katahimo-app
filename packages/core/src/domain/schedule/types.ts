import type { LatLng } from '../../ports/maps';

/**
 * 「今日/明日の予定」計算のドメイン型。
 *
 * 移植元: gas-childcare-visit-app/RouteSearch.js(getCalendarEvents〜calculateDetailedRoutes)。
 * GAS版はCalendarApp/Mapsの戻り値をそのまま引き回していたが、ここではカレンダーAPI・地図APIに
 * 依存しない値だけを扱う(取得はports/googleCalendar.ts・ports/maps.tsの実装側が行う)。
 */

/** カレンダーから取得した予定1件(Google Calendar APIのイベントをアダプターが変換したもの)。 */
export interface CalendarEvent {
  /**
   * 複数カレンダーに同じ予定が載っている場合(招待等)の重複排除キー。iCalUIDを使う
   * (GAS版 CalendarEvent.getId() もiCalUIDを返しており、同じキーで重複排除していた)。
   */
  dedupeKey: string;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  /** 終日予定か。終日予定はJSTの0:00〜翌0:00として start/end に入る。 */
  allDay: boolean;
  /** 主催者を除くゲストの表示名(表示名が無ければメールアドレス)。GAS版 getGuestList() 相当。 */
  guestNames: string[];
  /** このカレンダーの持ち主が出欠を「いいえ」にしているか(GAS版 getMyStatus() === NO)。 */
  declinedByOwner: boolean;
}

/** 1つのカレンダーから取得した予定一式。 */
export interface CalendarEventSource {
  /**
   * カレンダーの持ち主として扱う名前。GAS版はカレンダー名(calendar.getName())をそのまま
   * スタッフ名として使っていた(「[新規]」「[事務]」等の予定はカレンダー名でスタッフに割り当てる)。
   */
  ownerName: string;
  events: CalendarEvent[];
}

/** 住所2(単身赴任先等、期間限定の別住所)。期間は両端を含む 'YYYY-MM-DD'。 */
export interface TemporaryAddress {
  address: string;
  startDate: string;
  endDate: string;
}

/** ルート計算の起点・終点になる場所(顧客宅・予定の場所・スタッフの自宅)。 */
export interface Place {
  address: string;
  latLng: LatLng | null;
  temporaryAddress?: TemporaryAddress | null;
}

/** 予定タイトルとの突合に使う顧客。 */
export interface ScheduleCustomer {
  /** RESERVAの顧客ID(customers.external_id)。GAS版の出力 customerId と同じ値。未発行なら ''。 */
  customerId: string;
  /** 'Last First' 形式の氏名(GAS版の顧客CSV「姓 名」)。 */
  name: string;
  place: Place;
}

/** 予定の種別。値はGAS版の eventType 文字列そのまま(UI・出勤簿の判定がこの文字列に依存する)。 */
export type AppointmentType = 'CUSTOMER APPOINTMENT' | 'OFFICE WORK' | 'EVENT';

/** 分類済みの予定1件。 */
export interface Appointment {
  type: AppointmentType;
  start: Date;
  end: Date;
  /** 表示名(顧客名・予定名)。重なった事務作業をまとめた場合は「,」区切り。 */
  name: string;
  /** 突合できた顧客のRESERVA顧客ID。突合できない/顧客予定でなければ ''。 */
  customerId: string;
  place: Place;
  /** RESERVAの予約詳細URL(予約確定の説明欄から抽出)。無ければ ''。 */
  reservaUrl: string;
  /** この予定を担当するスタッフ名の候補(いずれかに一致すればそのスタッフの予定)。 */
  assigneeNames: string[];
}
