import type { AttendanceColumnKey } from '@katahimo/shared';

/**
 * 出勤簿1日分の入力列。キーは出勤簿スプレッドシートの列記号(attendance_days.row_data と同じ形)。
 * 各列の意味は sheetLayout.ts を参照(業務ロジックは列記号を直接書かず、そちらの名前付き定義を使う)。
 * 労働時間・残業などの派生値(テンプレートの数式列)は含まない。
 */
export type AttendanceRowData = Partial<Record<AttendanceColumnKey, string>>;
/** 画面から送られた修正(列が無い・undefined は「変えない」)。 */
export type AttendanceRowPatch = { [K in AttendanceColumnKey]?: string | undefined };

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
  /** 所定内+所定外 = 実際に働いた時間(laborMinutes は所定内だけ)。 */
  workedMinutes: number;
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
  workedMinutes: number;
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
  workedMinutes: number;
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
