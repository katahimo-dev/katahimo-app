import { addDaysYmd, WEEKDAY_LABELS, weekdayOfYmd, ymdParts } from '../../../lib/date';

/**
 * 日報ダイアログの日付・時刻まわりの小さな計算(GAS版 updateDateDisplay / updateDateTimeSummary_ /
 * changeDate / autoSetEndTime / buildReceiptTimestamp)。
 *
 * 日付は 'YYYY-MM-DD'(業務日。日本時間の暦日。lib/date.ts)で持つ。
 * 時刻は時・分の2つのセレクトの値('09' / '00')で持つ。
 */

/** 時・分のセレクトの値(どちらも2桁。分は 00 / 15 / 30 / 45) */
export interface ClockTime {
  hour: string;
  minute: string;
}

export const HOUR_OPTIONS: readonly string[] = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, '0'),
);
export const MINUTE_OPTIONS: readonly string[] = ['00', '15', '30', '45'];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 'HH:mm' */
export function formatClock(t: ClockTime): string {
  return `${t.hour}:${t.minute}`;
}

/** 'HH:mm' を時・分に分ける(GAS版の下書きの start / end)。形が違う部分は undefined。 */
export function parseClock(value: string | undefined): Partial<ClockTime> {
  if (!value) return {};
  const [hour, minute] = value.split(':');
  return { hour: hour || undefined, minute: minute || undefined };
}

/** 終わった時間 = 始めた時間 + 2時間(分はそのまま。24時を越えたら0時に戻す)。GAS版 autoSetEndTime。 */
export function autoEndTime(start: ClockTime): ClockTime | null {
  const hour = Number.parseInt(start.hour, 10);
  if (Number.isNaN(hour)) return null;
  return { hour: pad2((hour + 2) % 24), minute: start.minute };
}

function partsOf(dateStr: string) {
  return { ...ymdParts(dateStr), weekday: weekdayOfYmd(dateStr) };
}

/**
 * 「◀ 前の日」「次の日 ▶」で日付を動かす。今日より先には進めない(GAS版 changeDate)。
 * @returns 動かしたあとの日付。動かせないときは null
 */
export function shiftReportDate(current: string, offset: number, today: string): string | null {
  const next = addDaysYmd(current, offset);
  if (offset > 0 && next > today) return null;
  return next;
}

/** 「次の日 ▶」を押せないか(今日以降を表示しているとき) */
export function isNextDateDisabled(current: string, today: string): boolean {
  return current >= today;
}

/** 日付送りの真ん中の表示「2026年9月25日(金)」(GAS版 updateDateDisplay。かっこは半角) */
export function formatDateHeading(dateStr: string): string {
  const { year, month, day, weekday } = partsOf(dateStr);
  return `${year}年${month}月${day}日(${WEEKDAY_LABELS[weekday]})`;
}

/** 1行表示の日付の部分「9月25日（金）」(かっこは全角) */
export function formatDateShort(dateStr: string): string {
  const { month, day, weekday } = partsOf(dateStr);
  return `${month}月${day}日（${WEEKDAY_LABELS[weekday]}）`;
}

/**
 * 「変える」の左の1行表示(GAS版 updateDateTimeSummary_)。
 * - 日報: 「9月3日（水）10:00〜12:00」
 * - 事故: 「起きた日時」欄の値を使い「9月3日（水）10:05 に起きた」。欄が空なら日付だけ。
 *   AIが「2026年9月16日 10:00」のように日付ごと返すことがあるため、日付が入った値には日付を重ねない。
 */
export function formatDateTimeSummary(input: {
  mode: 'daily' | 'accident';
  date: string;
  start: ClockTime;
  end: ClockTime;
  occurrenceTime: string;
}): string {
  const dateText = formatDateShort(input.date);
  if (input.mode === 'daily') return `${dateText}${formatClock(input.start)}〜${formatClock(input.end)}`;
  const accTime = input.occurrenceTime.trim();
  if (!accTime) return dateText;
  const hasDateInValue = accTime.includes('月') || accTime.includes('/');
  return hasDateInValue ? `${accTime} に起きた` : `${dateText}${accTime} に起きた`;
}

/** 'YYYY/MM/DD'(GAS版の訪問日の書き方) */
export function toSlashDate(dateStr: string): string {
  return dateStr.replaceAll('-', '/');
}

/**
 * 領収書の日時が画像ごとに無いときに使う日時 = 日報の日付 + 始めた時間(秒は00)。
 * GAS版 buildReceiptTimestamp と同じ 'yyyy/MM/dd HH:mm:ss'。
 */
export function buildReceiptTimestamp(dateStr: string, start: Partial<ClockTime>): string {
  return `${toSlashDate(dateStr)} ${start.hour || '00'}:${start.minute || '00'}:00`;
}
