import {
  ATTENDANCE_COLUMN_KEYS,
  type AttendanceRowPatch,
  SHEET_DATE_COLUMN_INDEX,
  sheetColumnIndex,
} from '@katahimo/core/domain';
import type { AttendanceSheetImportRow } from '@katahimo/core/usecases';
import { parse } from 'csv-parse/sync';

export interface ParsedAttendanceSheet {
  rows: AttendanceSheetImportRow[];
  /** A列が日付として読めなかった行の数(見出し・合計の行等。取り込まない)。 */
  ignoredRowCount: number;
}

/** A列の日付: 'yyyy/M/d'・'yyyy-M-d'・'yyyy年M月d日'(後ろの曜日 '(火)' 等は無視)。年の無い 'M/d'・'M月d日' は year を使う。 */
const FULL_DATE = /^(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?/;
const MONTH_DAY = /^(\d{1,2})\s*[/月]\s*(\d{1,2})\s*日?/;

function parseSheetDate(value: string, year: number | undefined): string | null {
  const text = value.trim();
  const full = FULL_DATE.exec(text);
  const monthDay = full ? null : MONTH_DAY.exec(text);
  const [y, m, d] = full
    ? [Number(full[1]), Number(full[2]), Number(full[3])]
    : monthDay && year !== undefined
      ? [year, Number(monthDay[1]), Number(monthDay[2])]
      : [Number.NaN, Number.NaN, Number.NaN];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * 個別出勤簿(`<スタッフ名>_出勤簿_<年度>年度` の月のシート)を CSV に書き出したもの(Googleスプレッドシートの
 * 「ファイル → ダウンロード → CSV」、UTF-8)を読み、A列が日付の行を1日分ずつ返す。入力列(C〜AO)の位置は
 * 出勤簿の列の定義(sheetLayout.ts)から決める。空のセルは ''(取り込むとその列を空にする)。
 * year は A列に年が無い表記('9/1' 等)の場合の年。
 */
export function parseAttendanceSheetCsv(
  text: string,
  options: { year?: number } = {},
): ParsedAttendanceSheet {
  const content = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records = parse(content, { relax_column_count: true, skip_empty_lines: true }) as string[][];
  const result: ParsedAttendanceSheet = { rows: [], ignoredRowCount: 0 };
  records.forEach((record, index) => {
    const businessDate = parseSheetDate(record[SHEET_DATE_COLUMN_INDEX] ?? '', options.year);
    if (!businessDate) {
      result.ignoredRowCount++;
      return;
    }
    const rowData: AttendanceRowPatch = {};
    for (const column of ATTENDANCE_COLUMN_KEYS)
      rowData[column] = (record[sheetColumnIndex(column)] ?? '').trim();
    result.rows.push({ rowNumber: index + 1, businessDate, rowData });
  });
  return result;
}
