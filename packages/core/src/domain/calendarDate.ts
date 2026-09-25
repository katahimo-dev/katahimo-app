/**
 * 業務日('YYYY-MM-DD'、JST)・対象月('YYYY-MM')の計算。
 *
 * 出勤簿・勤怠はすべてJSTの暦日で扱う(GAS版はスクリプトのタイムゾーン Asia/Tokyo の
 * new Date() を前提にしていた)。サーバーのローカルタイムゾーンに依存しないよう、
 * 暦日の計算はすべてUTCの日付演算で行い、「今日」だけをJSTに換算して求める。
 * 'YYYY-MM-DD' の妥当性判定は domain/schedule/jstDate.ts の isValidBusinessDate を使う。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toUtcDate(businessDate: string): Date {
  const match = BUSINESS_DATE_PATTERN.exec(businessDate);
  if (!match) throw new Error(`日付が不正です。YYYY-MM-DD 形式で指定してください: ${businessDate}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** 'YYYY-MM'(月は01〜12)か。 */
export function isValidYearMonth(value: string): boolean {
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/** 指定時刻のJSTでの暦日。 */
export function jstBusinessDate(instant: Date): string {
  return formatUtcDate(new Date(instant.getTime() + JST_OFFSET_MS));
}

export function addDays(businessDate: string, days: number): string {
  return formatUtcDate(new Date(toUtcDate(businessDate).getTime() + days * DAY_MS));
}

/** start〜end(両端含む)の日数。end が start より前なら0以下。 */
export function countDaysInclusive(start: string, end: string): number {
  return Math.round((toUtcDate(end).getTime() - toUtcDate(start).getTime()) / DAY_MS) + 1;
}

export function yearMonthOf(businessDate: string): string {
  return businessDate.slice(0, 7);
}

export function firstDayOfMonth(yearMonth: string): string {
  return `${yearMonth}-01`;
}

export function lastDayOfMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const last = new Date(Date.UTC(year ?? 1970, month ?? 1, 0));
  return formatUtcDate(last);
}

/** 指定月の全日('YYYY-MM-DD')を昇順で返す。 */
export function datesOfMonth(yearMonth: string): string[] {
  const first = firstDayOfMonth(yearMonth);
  const count = countDaysInclusive(first, lastDayOfMonth(yearMonth));
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/** 指定月(JST)の [開始時刻, 翌月開始時刻) 。timestamptz列の範囲検索に使う。 */
export function jstMonthInstantRange(yearMonth: string): { from: Date; to: Date } {
  const from = new Date(toUtcDate(firstDayOfMonth(yearMonth)).getTime() - JST_OFFSET_MS);
  const to = new Date(toUtcDate(addDays(lastDayOfMonth(yearMonth), 1)).getTime() - JST_OFFSET_MS);
  return { from, to };
}

/** 'YYYY-MM-DD' → 'MM/dd'(GAS版 Utilities.formatDate(d, 'Asia/Tokyo', 'MM/dd') と同じ表記)。 */
export function formatMonthDay(businessDate: string): string {
  return `${businessDate.slice(5, 7)}/${businessDate.slice(8, 10)}`;
}
