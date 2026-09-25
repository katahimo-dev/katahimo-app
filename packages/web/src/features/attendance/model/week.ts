/**
 * 週間予定の日付・時刻の計算(GAS版 calYmd_ / calGetWeekStart_ / calTimeToMinutes_ /
 * calComputeHourRange_ / calSummarizeDayEvents_ など)。業務日は日本時間(lib/date.ts)で数える
 * (GAS版は端末の時計で数えていたが、日本以外の時刻帯の端末でも日付がずれないように)。
 */
import { addDaysYmd, jstHHmm, WEEKDAY_LABELS, weekdayOfYmd, ymdParts } from '../../../lib/date';

export const DAY_OF_WEEK_LABELS = WEEKDAY_LABELS;

/** 予定の種類(API は訪問・事務作業の2種類。GAS版の予定タブと同じくイベントも見た目だけ用意する)。 */
export type CalendarEventType = 'CUSTOMER APPOINTMENT' | 'OFFICE WORK' | 'EVENT';

export interface CalendarEvent {
  date: string;
  slotKey: string;
  title: string;
  eventType: CalendarEventType;
  start: string;
  end: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export { addDaysYmd, todayJst } from '../../../lib/date';

/** その日を含む週の日曜日(GAS版 calGetWeekStart_) */
export function weekStartOf(ymd: string): string {
  return addDaysYmd(ymd, -weekdayOfYmd(ymd));
}

/** 週の7日('YYYY-MM-DD')。 */
export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
}

export function dayOfMonth(ymd: string): number {
  return ymdParts(ymd).day;
}

export function dayOfWeekLabel(ymd: string): string {
  return DAY_OF_WEEK_LABELS[weekdayOfYmd(ymd)] as string;
}

/** 「8月31日〜9月6日」(GAS版 loadWeekEvents の #calWeekLabel) */
export function weekRangeLabel(weekStart: string): string {
  const start = ymdParts(weekStart);
  const end = ymdParts(addDaysYmd(weekStart, 6));
  return `${start.month}月${start.day}日〜${end.month}月${end.day}日`;
}

/** 読み込んだ時刻「10:05 時点」(日本時間。GAS版 formatCalWeekUpdatedAt_ / formatAttendanceMonthlyUpdatedAt_) */
export function updatedAtLabel(ts: number | null | undefined): string {
  if (!ts) return '';
  return `${jstHHmm(ts)} 時点`;
}

/** 'HH:MM' → 0時からの分。形が違えば null(GAS版 calTimeToMinutes_) */
export function timeToMinutes(hhmm: string | null | undefined): number | null {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 分 → 'HH:MM'。日をまたぐ分(25:00 等)は24時間で割った余り(GAS版 calMinutesToHhmm_) */
export function minutesToHhmm(min: number): string {
  const raw = Math.max(0, Math.round(Number(min) || 0));
  const m = raw % (24 * 60);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export const DEFAULT_START_HOUR = 9;
export const DEFAULT_END_HOUR = 20;

/**
 * 表(グリッド)に出す時間の範囲。ふだんは9〜20時、それより早い・遅い予定があればその分だけ広げる
 * (GAS版 calComputeHourRange_)。
 */
export function computeHourRange(events: readonly Pick<CalendarEvent, 'start' | 'end'>[]): {
  startHour: number;
  endHour: number;
} {
  let startHour = DEFAULT_START_HOUR;
  let endHour = DEFAULT_END_HOUR;
  for (const e of events) {
    const s = timeToMinutes(e.start);
    const en = timeToMinutes(e.end);
    if (s !== null) startHour = Math.min(startHour, Math.floor(s / 60));
    if (en !== null) endHour = Math.max(endHour, Math.ceil(en / 60));
  }
  if (endHour <= startHour) endHour = startHour + 1;
  return { startHour, endHour };
}

/** 予定の種類の名前(GAS版 formatEventTypeLabel_) */
export function eventTypeLabel(eventType: string): string {
  if (eventType === 'CUSTOMER APPOINTMENT') return 'お客様の訪問';
  if (eventType === 'OFFICE WORK') return '事務作業';
  if (eventType === 'EVENT') return 'イベント';
  return eventType || '';
}

/**
 * 一覧に出す件名。お客様の訪問はお客様名、それ以外は種類の名前(件名もあれば「事務作業（mtg）」)。
 * GAS版 calEventTitleForList_。
 */
export function eventTitleForList(e: Pick<CalendarEvent, 'title' | 'eventType'>): string {
  const title = String(e.title || '').trim();
  if (e.eventType === 'CUSTOMER APPOINTMENT') return title || '（名前なし）';
  const typeLabel = eventTypeLabel(e.eventType);
  if (!title) return typeLabel || '（名前なし）';
  if (!typeLabel || title === typeLabel) return title;
  return `${typeLabel}（${title}）`;
}

export interface DaySummary {
  /** 時間順に並べ直した予定 */
  sorted: CalendarEvent[];
  /** 時間順の件名を「 → 」でつないだもの */
  titles: string;
  /** 最も早い始め〜最も遅い終わり(時刻が読めなければ '') */
  timeRange: string;
  /** 各予定の(終わり−始め)の合計(分) */
  totalMinutes: number;
}

/** 1日分の予定を一覧の1行にまとめる(GAS版 calSummarizeDayEvents_) */
export function summarizeDayEvents(events: readonly CalendarEvent[]): DaySummary {
  const sorted = [...events].sort((a, b) => {
    const sa = timeToMinutes(a.start);
    const sb = timeToMinutes(b.start);
    return (sa === null ? 9999 : sa) - (sb === null ? 9999 : sb);
  });
  let earliest: number | null = null;
  let latest: number | null = null;
  let totalMinutes = 0;
  for (const e of sorted) {
    const s = timeToMinutes(e.start);
    let en = timeToMinutes(e.end);
    // 日をまたぐ予定(22:00〜01:00)は終わりを翌日分(+24時間)として扱う
    if (s !== null && en !== null && en < s) en += 24 * 60;
    if (s !== null && (earliest === null || s < earliest)) earliest = s;
    if (en !== null && (latest === null || en > latest)) latest = en;
    if (s !== null && en !== null) totalMinutes += Math.max(0, en - s);
  }
  const timeRange =
    earliest !== null && latest !== null ? `${minutesToHhmm(earliest)}〜${minutesToHhmm(latest)}` : '';
  return { sorted, titles: sorted.map(eventTitleForList).join(' → '), timeRange, totalMinutes };
}

/** 表・1日表示での予定の縦位置と高さ(px)。0時ちょうども正しく扱うため null で判定する。 */
export function eventBox(
  e: Pick<CalendarEvent, 'start' | 'end'>,
  startHour: number,
  hourHeight: number,
  minHeight: number,
): { top: number; height: number } {
  const startRaw = timeToMinutes(e.start);
  const endRaw = timeToMinutes(e.end);
  const startMin = startRaw !== null ? startRaw : 0;
  const endMin = endRaw !== null ? endRaw : startMin;
  return {
    top: (startMin / 60 - startHour) * hourHeight,
    height: Math.max(minHeight, ((endMin - startMin) / 60) * hourHeight),
  };
}

export function hoursBetween(startHour: number, endHour: number): number[] {
  return Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
}
