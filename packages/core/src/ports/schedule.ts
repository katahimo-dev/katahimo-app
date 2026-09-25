/**
 * 「今日/明日の予定」閲覧のポート。GAS版RouteSearch.jsのgetScheduleForStaffOnDate/
 * getScheduleWithRouteForStaffOnDateに対応する。
 *
 * CalendarPort(将来の個別カレンダーCRUD向け)とは別に用意している。GAS版はカレンダー解析
 * (RESERVA予約タイトルの分類・スタッフとの突合)・ルート計算・キャッシュを一体で行っており、
 * その分類ロジックは実務で磨かれた複雑なものである(gas-root-serach/gas-childcare-visit-appの
 * RouteSearch.js参照)。誤って再実装すると本番と挙動がずれるリスクが大きいため、移行期は
 * GAS側の実装(既に本番で動いているもの)をそのまま「今日/明日の予定を返す」単位の操作として
 * 呼び出す(実装はgas-bridge、Bridge.js経由)。Sheets/Calendar脱却時にこの実装だけを差し替える。
 */

/** ルート・移動時間を含まない軽量版(getScheduleForStaffOnDate)の1件。 */
export interface ScheduleAppointmentLight {
  title: string;
  eventType: string;
  /** 'HH:mm' */
  start: string;
  /** 'HH:mm' */
  end: string;
  address: string;
}

export interface ScheduleLightResult {
  success: boolean;
  date?: string;
  staffName?: string;
  appointments?: ScheduleAppointmentLight[];
  message?: string;
}

/** ルート・移動時間つき(getScheduleWithRouteForStaffOnDate)の1件。 */
export interface ScheduleAppointmentWithRoute {
  eventType: string;
  customerName: string;
  /** 'HH:mm' */
  startTime: string;
  /** 'HH:mm' */
  endTime: string;
  reservaUrl: string;
  moveUrl: string;
  moveMin: number | string;
  moveKm: number | string;
  attendanceUrl: string;
  attendanceMin: number | string;
  attendanceKm: number | string;
  leavingUrl: string;
  leavingMin: number | string;
  leavingKm: number | string;
  customerId: string;
  address: string;
}

export interface ScheduleWithRouteResult {
  success: boolean;
  date?: string;
  staffName?: string;
  appointments?: ScheduleAppointmentWithRoute[];
  message?: string;
}

export interface SchedulePort {
  getSchedule(staffName: string, dateString: string): Promise<ScheduleLightResult>;
  getScheduleWithRoute(
    staffName: string,
    dateString: string,
    forceRefresh: boolean,
  ): Promise<ScheduleWithRouteResult>;
}
