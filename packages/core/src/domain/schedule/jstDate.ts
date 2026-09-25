/**
 * 予定計算のJST日付境界。GAS版はスクリプトのタイムゾーン(appsscript.json: Asia/Tokyo)で
 * `setHours(0,0,0,0)` 〜 `setHours(23,59,59,999)` を1日としていた。サーバーのタイムゾーンに
 * 依存しないよう、ここではJST(UTC+9、夏時間なし)を明示して計算する。
 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' が実在する日付か(2026-02-30 等は不正)。 */
export function isValidBusinessDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** JSTの指定日0:00から翌日0:00までの半開区間 [from, to)。 */
export function jstDayRange(businessDate: string): { from: Date; to: Date } {
  if (!isValidBusinessDate(businessDate)) throw new Error(`不正な日付です: ${businessDate}`);
  const from = new Date(Date.parse(`${businessDate}T00:00:00+09:00`));
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/** 'YYYY-MM-DD' のJST 0:00。終日予定(Google Calendarの start.date/end.date)の変換に使う。 */
export function jstMidnight(businessDate: string): Date {
  return jstDayRange(businessDate).from;
}

/** GAS版 Utilities.formatDate(d, 'JST', 'HH:mm') と同じ 'HH:mm'。 */
export function formatJstTime(date: Date): string {
  const shifted = new Date(date.getTime() + JST_OFFSET_MS);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** JSTでの今日の 'YYYY-MM-DD'。 */
export function jstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}
