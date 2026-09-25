import { ATTENDANCE_COLUMNS, type AttendanceColumnKey, type CellChange } from './sheetLayout';
import type { AttendanceRowData } from './types';

/** 1セル分の変更(プレビュー表示・変更履歴に使う)。 */
export type AttendanceCellChange = CellChange;

/** 未入力は空文字として扱う(スプレッドシートの空セル = '' と同じ)。 */
export function cellValue(rowData: AttendanceRowData, column: AttendanceColumnKey): string {
  return rowData[column] ?? '';
}

export function cellChange(
  column: AttendanceColumnKey,
  oldValue: string,
  newValue: string,
): AttendanceCellChange {
  return { column, label: ATTENDANCE_COLUMNS[column].label, oldValue, newValue };
}
