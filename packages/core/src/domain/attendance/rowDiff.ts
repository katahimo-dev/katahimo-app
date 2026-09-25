import { ATTENDANCE_COLUMNS, type AttendanceColumnKey } from './sheetLayout';
import type { AttendanceRowData } from './types';

/** 1セル分の変更(プレビュー表示・変更履歴・ミラー時の強調表示に使う)。 */
export interface AttendanceCellChange {
  column: AttendanceColumnKey;
  label: string;
  oldValue: string;
  newValue: string;
}

/** 列の表示順(GAS版 PAST_SCHEDULE_INPUT_COLUMNS の定義順)。 */
export const ATTENDANCE_COLUMN_ORDER = Object.keys(ATTENDANCE_COLUMNS) as AttendanceColumnKey[];

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

/**
 * 手入力の修正(patch)を現在の行に当てた結果。patch に含まれる列だけを比較し、値が変わった列だけを
 * changes に入れる(GAS版 updatePastSchedule の「変更されたセルだけ書き込む」と同じ)。
 */
export function applyRowPatch(
  current: AttendanceRowData,
  patch: AttendanceRowData,
): { next: AttendanceRowData; changes: AttendanceCellChange[] } {
  const next: AttendanceRowData = { ...current };
  const changes: AttendanceCellChange[] = [];
  for (const column of ATTENDANCE_COLUMN_ORDER) {
    const newValue = patch[column];
    if (newValue === undefined) continue;
    const oldValue = cellValue(current, column);
    if (oldValue === newValue) continue;
    next[column] = newValue;
    changes.push(cellChange(column, oldValue, newValue));
  }
  return { next, changes };
}

/** 変更のあった列を、既存の「手で変更された列」に重複なく足し合わせる(列の定義順に並べる)。 */
export function mergeChangedFields(existing: readonly string[], changed: readonly string[]): string[] {
  const all = new Set([...existing, ...changed]);
  return ATTENDANCE_COLUMN_ORDER.filter((column) => all.has(column));
}
