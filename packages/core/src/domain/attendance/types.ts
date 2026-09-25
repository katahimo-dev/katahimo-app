/**
 * 出勤簿テンプレート(出勤簿テンプレート.xlsx)の入力列1日分。
 * 移植元: gas-childcare-visit-app/AttendanceCalc.js のコメント、
 * PastSchedule.js の PAST_SCHEDULE_INPUT_COLUMNS。
 *
 * 列名(C/D/E等)はスプレッドシートの列記号をそのままキーにしている。読みにくく見えるが、
 * GAS版・webapp-poc版と全く同じキー名にしておくことで、実データを使った数値照合
 * (このオブジェクトをそのまま両実装に渡して出力を比較する)が row_data の変換なしにできる、
 * という利点を優先した意図的な選択(Phase 7で実データ突き合わせを行う際にそのまま使う)。
 *
 *   C/D/E = #1訪問先/始業/終業, I = #1後の気象状況, H = #1→#2計画移動時間(分)
 *   L/M/N = #2訪問先/始業/終業, R = #2後の気象状況, Q = #2→#3計画移動時間(分)
 *   U/V/W = #3訪問先/始業/終業
 *   X/Y/Z = 事務作業1/開始/終了, AA/AB/AC = 事務作業2/開始/終了
 *   AG = #1移動距離(km), AH = #2移動距離(km), AI = 出勤距離(km), AJ = 退勤距離(km)
 *   AN = 買物代行, AO = 備考
 */
export interface AttendanceRowData {
  C?: string;
  D?: string;
  E?: string;
  H?: string;
  I?: string;
  L?: string;
  M?: string;
  N?: string;
  Q?: string;
  R?: string;
  U?: string;
  V?: string;
  W?: string;
  X?: string;
  Y?: string;
  Z?: string;
  AA?: string;
  AB?: string;
  AC?: string;
  AG?: string;
  AH?: string;
  AI?: string;
  AJ?: string;
  AN?: string;
  AO?: string;
}

export interface MoveChainResult {
  moveStart: string;
  moveEnd: string;
  weatherAdjustedMoveMin: number | '';
  waitMin: number | '';
}

export interface CoreAndOvertime {
  core: number;
  overtime: number;
}

export interface LaborAndOvertime {
  laborMinutes: number;
  overtimeMinutes: number;
}

export interface DistanceAggregates {
  totalMoveMin: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCount: number;
}

export interface AttendanceDayDerived {
  leg1MoveStart: string;
  leg1MoveEnd: string;
  leg1WeatherAdjustedMoveMin: number | '';
  leg1WaitMin: number | '';
  leg2MoveStart: string;
  leg2MoveEnd: string;
  leg2WeatherAdjustedMoveMin: number | '';
  leg2WaitMin: number | '';
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCount: number;
}

export interface AttendanceMonthlyDay {
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
}

export interface AttendanceMonthlyTotals {
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  leg1DistanceKmTotal: number;
  leg2DistanceKmTotal: number;
  attendanceDistanceKmTotal: number;
  leavingDistanceKmTotal: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCountTotal: number;
  shoppingErrandTotal: number;
}
