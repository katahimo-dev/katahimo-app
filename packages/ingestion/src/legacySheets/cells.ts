import {
  formatLegacyWallClock,
  legacyTimeOfDay,
  legacyWallClockFromSerial,
  parseLegacyWallClockText,
} from '@katahimo/core/domain';
import type { LegacySheetCell } from '@katahimo/core/ports';
import { stripControlChars } from '@katahimo/shared';

/**
 * GAS版のスプレッドシートのセルの読み方(移行の取込)。列の位置の知識は reportSheets.ts / receiptSheet.ts に置き、
 * ここはセルの値の形だけを扱う。
 */

const EMPTY: LegacySheetCell = { value: null, text: '' };

export function cellAt(row: readonly LegacySheetCell[], index: number): LegacySheetCell {
  return row[index] ?? EMPTY;
}

export function isBlankRow(row: readonly LegacySheetCell[]): boolean {
  return row.every((cell) => cell.text.trim() === '' && (cell.value === null || cell.value === ''));
}

/** シートに表示されている文字列(自由記述。改行・タブ以外の制御文字を除く。前後の空白は残す)。 */
export function cellText(cell: LegacySheetCell): string {
  return stripControlChars(cell.text);
}

/** 前後の空白を除いた表示の文字列(氏名・種別等)。 */
export function cellTrimmed(cell: LegacySheetCell): string {
  return cellText(cell).trim();
}

/**
 * ID の列(顧客ID 等)。スプレッドシートは数字だけの ID を数値にするため、表示形式(桁区切り等)ではなく値から読む。
 */
export function cellId(cell: LegacySheetCell): string {
  if (typeof cell.value === 'number') return Number.isInteger(cell.value) ? String(cell.value) : '';
  if (typeof cell.value === 'string') return stripControlChars(cell.value).trim();
  return cellTrimmed(cell);
}

/** 日時の列 → 'yyyy/MM/dd HH:mm:ss'(日時の値でも文字列でも)。読めなければ null。 */
export function cellWallClock(cell: LegacySheetCell): string | null {
  if (typeof cell.value === 'number') {
    const wall = legacyWallClockFromSerial(cell.value);
    return wall ? formatLegacyWallClock(wall) : null;
  }
  const wall = parseLegacyWallClockText(typeof cell.value === 'string' ? cell.value : cell.text);
  return wall ? formatLegacyWallClock(wall) : null;
}

/** 時刻の列 → 'HH:mm'。空は ''、読めなければ null。 */
export function cellTimeOfDay(cell: LegacySheetCell): string | null {
  if (typeof cell.value === 'number') return legacyTimeOfDay(cell.value);
  const text = typeof cell.value === 'string' ? cell.value.trim() : cell.text.trim();
  return text === '' ? '' : legacyTimeOfDay(text);
}

/** 評価の列(PSI・ES。1〜5 の整数)。空は null、それ以外の値は 'invalid'。 */
export function cellRating(cell: LegacySheetCell): number | null | 'invalid' {
  const raw = typeof cell.value === 'number' ? String(cell.value) : cellTrimmed(cell);
  if (raw === '') return null;
  const n = Number(raw.normalize('NFKC'));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 'invalid';
}

/** 金額の列(値が数値なら数字の文字列、文字列ならそのまま)。 */
export function cellAmount(cell: LegacySheetCell): string {
  if (typeof cell.value === 'number') return Number.isFinite(cell.value) ? String(cell.value) : '';
  return cellTrimmed(cell);
}
