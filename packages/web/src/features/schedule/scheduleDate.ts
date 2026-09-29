import { addDaysYmd, jstHHmm, todayJst, WEEKDAY_LABELS, weekdayOfYmd, ymdParts } from '../../lib/date';

/**
 * 予定タブの日付(GAS版 loadScheduleForOffset_ の日付の計算と「9月3日（水）今日」の表記)。
 * 業務日はJSTで数える(端末の時刻帯が日本以外でも、日付がずれないように)。
 */

/** ☀️今日 = 0 / 🌙明日 = 1 */
export type ScheduleOffset = 0 | 1;

export interface ScheduleDate {
  /** 'YYYY-MM-DD'(JST) */
  dateStr: string;
  /** 「9月3日（水）今日」 */
  label: string;
}

export function scheduleDateFor(offset: ScheduleOffset, now: Date = new Date()): ScheduleDate {
  const dateStr = addDaysYmd(todayJst(now), offset);
  const { month, day } = ymdParts(dateStr);
  const dow = WEEKDAY_LABELS[weekdayOfYmd(dateStr)];
  const suffix = offset === 0 ? '今日' : '明日';
  return { dateStr, label: `${month}月${day}日（${dow}）${suffix}` };
}

/** 「HH:MM 時点」(GAS版 renderScheduleWithRoute の scheduleRouteMeta)。JSTで表す。 */
export function formatRouteFetchedAt(ts: number): string {
  return `${jstHHmm(ts)} 時点`;
}

/** 出している予定が最新か(useScheduleView の routeFreshness)を「HH:MM 時点」に添える文言 */
const FRESHNESS_NOTE = {
  fresh: '',
  revalidating: '（最新を確認中…）',
  stale: '（最新を読み込めませんでした）',
} as const;

/** 予定の一覧の下に出す「HH:MM 時点（最新を確認中…）」 */
export function routeMetaText(
  fetchedAt: number | null,
  freshness: 'fresh' | 'revalidating' | 'stale' | null,
): string {
  if (fetchedAt === null) return '';
  return `${formatRouteFetchedAt(fetchedAt)}${freshness ? FRESHNESS_NOTE[freshness] : ''}`;
}
