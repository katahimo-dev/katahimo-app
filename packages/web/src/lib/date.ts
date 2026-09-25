/**
 * 業務日・時刻の計算。業務日は端末の時刻帯に関係なく **日本時間(Asia/Tokyo)** で数える
 * (契約の businessDateSchema と同じ 'YYYY-MM-DD')。
 *
 * - 「いま」から日付・時刻を取り出すものは Intl.DateTimeFormat(timeZone: Asia/Tokyo)を使う。
 * - 'YYYY-MM-DD' どうしの計算(日を足す・曜日)は時刻帯の影響を受けないよう UTC の暦で計算する。
 */
export const BUSINESS_TIME_ZONE = 'Asia/Tokyo';

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface JstParts {
  year: number;
  /** 1〜12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = 日曜 */
  weekday: number;
}

let formatter: Intl.DateTimeFormat | null = null;
function jstFormatter(): Intl.DateTimeFormat {
  formatter ??= new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  });
  return formatter;
}

/** ある時点(Date かミリ秒)の日本時間の年月日・時分・曜日 */
export function jstParts(at: Date | number = Date.now()): JstParts {
  const parts: Record<string, number> = {};
  for (const p of jstFormatter().formatToParts(at)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const year = parts.year ?? 0;
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  return {
    year,
    month,
    day,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** その時点の日本時間の日付 'YYYY-MM-DD' */
export function jstDateString(at: Date | number = Date.now()): string {
  const { year, month, day } = jstParts(at);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 今日(日本時間)'YYYY-MM-DD' */
export function todayJst(now: Date | number = Date.now()): string {
  return jstDateString(now);
}

/** その時点の日本時間の時刻 'HH:mm' */
export function jstHHmm(at: Date | number = Date.now()): string {
  const { hour, minute } = jstParts(at);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** 'YYYY-MM-DD' を年・月・日に分ける */
export function ymdParts(ymd: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = ymd.split('-').map(Number);
  return { year, month, day };
}

/** 'YYYY-MM-DD' に days 日を足す(暦の計算だけ。時刻帯の影響を受けない) */
export function addDaysYmd(ymd: string, days: number): string {
  const { year, month, day } = ymdParts(ymd);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD' の曜日(0 = 日曜) */
export function weekdayOfYmd(ymd: string): number {
  const { year, month, day } = ymdParts(ymd);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
