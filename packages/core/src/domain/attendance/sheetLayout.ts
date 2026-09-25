import type { AttendanceColumnKey } from '@katahimo/shared';

/**
 * 出勤簿テンプレート(個別出勤簿スプレッドシート)の列レイアウト。
 *
 * 列記号(C/D/E…)と業務上の意味(訪問#1の始業時刻、#1→#2の移動距離…)の対応を持つのは
 * このファイルだけ。計算・カレンダー反映などの業務ロジックは、列記号を直接書かずに
 * ここの名前付き定義(VISIT_SLOTS / MOVE_LEGS 等)を経由して rowData を読み書きする。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の PAST_SCHEDULE_INPUT_COLUMNS /
 * PAST_SCHEDULE_SYNC_SLOTS、AttendanceCalc.js のコメント(列ごとの意味)。
 */

export type { AttendanceColumnKey } from '@katahimo/shared';
export { ATTENDANCE_COLUMN_KEYS } from '@katahimo/shared';

export type AttendanceColumnKind = 'text' | 'time' | 'number' | 'select';

/** 各入力列の表示名と入力種別(GAS版 PAST_SCHEDULE_INPUT_COLUMNS と同じ)。 */
export const ATTENDANCE_COLUMNS: Readonly<
  Record<AttendanceColumnKey, { label: string; kind: AttendanceColumnKind }>
> = {
  C: { kind: 'text', label: '#1訪問先等' },
  D: { kind: 'time', label: '#1始業時刻' },
  E: { kind: 'time', label: '#1終業時刻' },
  AI: { kind: 'number', label: '#1出勤距離' },
  I: { kind: 'select', label: '天候' },
  H: { kind: 'number', label: '#1→#2移動時間' },
  L: { kind: 'text', label: '#2訪問先等' },
  M: { kind: 'time', label: '#2始業時刻' },
  N: { kind: 'time', label: '#2終業時刻' },
  AG: { kind: 'number', label: '#1→#2移動距離' },
  R: { kind: 'select', label: '天候' },
  Q: { kind: 'number', label: '#2→#3移動時間' },
  U: { kind: 'text', label: '#3訪問先等' },
  V: { kind: 'time', label: '#3始業時刻' },
  W: { kind: 'time', label: '#3終業時刻' },
  AH: { kind: 'number', label: '#2→#3移動距離' },
  AJ: { kind: 'number', label: '退勤距離' },
  X: { kind: 'text', label: '作業１' },
  Y: { kind: 'time', label: '作業１開始' },
  Z: { kind: 'time', label: '作業１終了' },
  AA: { kind: 'text', label: '作業２' },
  AB: { kind: 'time', label: '作業２開始' },
  AC: { kind: 'time', label: '作業２終了' },
  AN: { kind: 'number', label: '買物代行' },
  AO: { kind: 'text', label: '備考' },
};

export type AttendanceSlotKey = 'slot1' | 'slot2' | 'slot3' | 'office1' | 'office2';

/** 1つの時間帯(訪問 or 事務作業)。title=訪問先/作業内容、start/end=開始/終了時刻の列。 */
export interface AttendanceTimeSlot {
  key: AttendanceSlotKey;
  kind: 'visit' | 'office';
  title: AttendanceColumnKey;
  start: AttendanceColumnKey;
  end: AttendanceColumnKey;
  /**
   * カレンダー反映でこの時間帯と一緒に書き換える列(GAS版 PAST_SCHEDULE_SYNC_SLOTS の cols、順序も同じ)。
   * 訪問#2/#3は直前からの移動時間・移動距離、訪問#1は出勤距離を含む。
   */
  syncColumns: readonly AttendanceColumnKey[];
}

/** 出勤距離(自宅→最初の訪問先)。 */
export const COMMUTE_DISTANCE_COLUMN: AttendanceColumnKey = 'AI';
/** 退勤距離(最後の訪問先→自宅)。訪問件数によって#1〜#3のどれかに付随する。 */
export const LEAVING_DISTANCE_COLUMN: AttendanceColumnKey = 'AJ';
/** 買物代行。 */
export const SHOPPING_ERRAND_COLUMN: AttendanceColumnKey = 'AN';
/** 備考。 */
export const REMARKS_COLUMN: AttendanceColumnKey = 'AO';

export const VISIT_SLOTS: readonly [AttendanceTimeSlot, AttendanceTimeSlot, AttendanceTimeSlot] = [
  { key: 'slot1', kind: 'visit', title: 'C', start: 'D', end: 'E', syncColumns: ['C', 'D', 'E', 'AI'] },
  { key: 'slot2', kind: 'visit', title: 'L', start: 'M', end: 'N', syncColumns: ['H', 'L', 'M', 'N', 'AG'] },
  { key: 'slot3', kind: 'visit', title: 'U', start: 'V', end: 'W', syncColumns: ['Q', 'U', 'V', 'W', 'AH'] },
];

export const OFFICE_SLOTS: readonly [AttendanceTimeSlot, AttendanceTimeSlot] = [
  { key: 'office1', kind: 'office', title: 'X', start: 'Y', end: 'Z', syncColumns: ['X', 'Y', 'Z'] },
  { key: 'office2', kind: 'office', title: 'AA', start: 'AB', end: 'AC', syncColumns: ['AA', 'AB', 'AC'] },
];

/** 訪問#1〜#3・事務作業#1〜#2の順(GAS版 PAST_SCHEDULE_SYNC_SLOTS と同じ順序)。 */
export const ATTENDANCE_SLOTS: readonly AttendanceTimeSlot[] = [...VISIT_SLOTS, ...OFFICE_SLOTS];

/** 訪問間の移動(#1→#2、#2→#3)。計画移動時間・移動後の天候・移動距離の列。 */
export interface MoveLeg {
  from: AttendanceTimeSlot;
  to: AttendanceTimeSlot;
  plannedMinutes: AttendanceColumnKey;
  weather: AttendanceColumnKey;
  distanceKm: AttendanceColumnKey;
}

export const MOVE_LEGS: readonly [MoveLeg, MoveLeg] = [
  { from: VISIT_SLOTS[0], to: VISIT_SLOTS[1], plannedMinutes: 'H', weather: 'I', distanceKm: 'AG' },
  { from: VISIT_SLOTS[1], to: VISIT_SLOTS[2], plannedMinutes: 'Q', weather: 'R', distanceKm: 'AH' },
];

/**
 * 天候の選択肢。GAS版はシート(I5/R5セル)の入力規則から読み、読めない場合は画面側で
 * この4つにフォールバックしていた。移動時間の積雪補正は '雪' のときだけ掛かる。
 */
export const WEATHER_OPTIONS: readonly string[] = ['晴れ', '曇り', '雨', '雪'];
export const SNOW_WEATHER = '雪';
