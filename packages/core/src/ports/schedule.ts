/**
 * 「今日/明日の予定」閲覧のポート。GAS版RouteSearch.jsのgetScheduleForStaffOnDate/
 * getScheduleWithRouteForStaffOnDateに対応する。
 *
 * 実装は2つあり、環境変数 SCHEDULE_PROVIDER で切り替える(doc/05_バッチ・外部連携.md 4章)。
 * - GoogleSchedulePort(packages/integrations/src/google-schedule): Google Calendar API +
 *   Google Maps Platform を直接呼び、domain/schedule のGAS移植ロジックで計算する。
 * - GasBridgeSchedulePort: 稼働中のGAS版Web App(Bridge.js)に計算ごと委ねる(移行期の実装)。
 * どちらも同じ形の結果(GAS版の戻り値そのままの形)を返す。
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
  /**
   * 閲覧で読めないカレンダーがあり、予定が欠けているかもしれない(読めた分だけの結果)。欠けていなければ省く。
   * 画面はこの結果で前回の表示を置き換えない。strict / fresh は部分的な結果を返さず失敗させる。
   */
  partial?: boolean;
}

/**
 * ルート・移動時間つき(getScheduleWithRouteForStaffOnDate)の1件。
 * 移動時間(分)は数値、距離(km)は小数2桁の文字列(GAS版 toFixed(2) のまま)。算出できない区間は ''。
 */
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
  /** RESERVAの顧客ID(customers.external_id)。 */
  customerId: string;
  address: string;
}

export interface ScheduleWithRouteResult {
  success: boolean;
  date?: string;
  staffName?: string;
  appointments?: ScheduleAppointmentWithRoute[];
  message?: string;
  /** ScheduleLightResult.partial と同じ */
  partial?: boolean;
}

/** 1回のルートつきの計算で、実際に地図APIを呼んだ回数と共有キャッシュで済ませた回数(ログ用)。 */
export interface MapsUsage {
  geocodeCalls: number;
  routeCalls: number;
  cacheHits: number;
}

export interface ScheduleRequestOptions {
  /**
   * 対象テナント。GoogleSchedulePortは顧客・スタッフ・カレンダー設定をこのテナントから引くため必須
   * (無いと例外)。GasBridgeSchedulePort/NoopSchedulePortは使わない。
   */
  tenantId?: string;
  /**
   * 軽量版(getSchedule)で、読めないカレンダーがあれば飛ばさずに失敗させる(予定が欠けたまま使わない。翌日の予定の
   * お知らせのジョブ)。ルートつきは fresh が同じ意味を持つ。
   */
  strict?: boolean;
}

export interface ScheduleWithRouteOptions extends ScheduleRequestOptions {
  /**
   * trueの場合、地図の結果(区間ごとのルート・ジオコーディング)の共有キャッシュを読みも書きもせず、
   * その時点のカレンダーと地図APIから計算する(予定そのものは fresh でなくても毎回カレンダーから読む)。
   * 公式な勤怠記録(出勤簿・勤怠集計)へ書き込む経路は必ずtrueにすること
   * (GAS版 refreshAttendanceForStaffOnDate がキャッシュを使わないのと同じ規則)。
   */
  fresh?: boolean;
  /** 地図APIの呼び出し回数を受け取る(ログ用。GoogleSchedulePort だけが呼ぶ)。 */
  onMapsUsage?: (usage: MapsUsage) => void;
}

/**
 * 予定を見るスタッフ。識別は staffId で行い、氏名はカレンダーの予定の文字列(タイトル・説明欄の担当者名)との
 * 突き合わせにだけ使う(GAS版は氏名で全てを突き合わせていた)。
 */
export interface ScheduleTarget {
  staffId: string;
  staffName: string;
}

export interface SchedulePort {
  getSchedule(
    target: ScheduleTarget,
    dateString: string,
    options?: ScheduleRequestOptions,
  ): Promise<ScheduleLightResult>;
  /**
   * 予定は毎回カレンダーから読む(担当変更をすぐ出す)。キャッシュするのは地図の結果(区間・住所ごと)だけ。
   * forceRefresh=true は「🔄 最新にする」ボタン用: 地図の結果のキャッシュを読まずに調べ直し、結果はキャッシュに
   * 書き直す(以後の閲覧に反映させるため)。キャッシュに一切触れない場合は options.fresh を使う。
   * (gas_bridge では GAS版側のスタッフ×日のキャッシュのまま。forceRefresh / fresh だけが読み飛ばす)
   */
  getScheduleWithRoute(
    target: ScheduleTarget,
    dateString: string,
    forceRefresh: boolean,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleWithRouteResult>;
}
