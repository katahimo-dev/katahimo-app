import { SCHEDULE_LINK_PARAM, scheduleLinkDateOf } from '@katahimo/shared';
import { addDaysYmd, todayJst } from '../../lib/date';
import type { ScheduleOffset } from './scheduleDate';

/**
 * 予定タブを日付を指定して開くリンク(翌日の予定のお知らせ(Web Push)を押したとき)。
 * - アプリが開いていなかった: 通知の URL(`/?schedule=YYYY-MM-DD`)で起動する。予定タブは最初の描画でその日を選び、
 *   画面の骨格(useScheduleLinkNavigation)が URL から取り除く。
 * - アプリが開いていた: Service Worker(public/push-sw.js)が画面を前に出し、URL をメッセージで知らせる。
 * 予定タブは今日・明日だけを出すため、明日(JST)なら「明日」、それ以外(翌朝に押した等)は「今日」にする。
 */

/** Service Worker からのメッセージの種類(public/push-sw.js と同じ値)。 */
export const NOTIFICATION_CLICK_MESSAGE = 'katahimo:notification-click';

export function scheduleOffsetForDate(date: string, now: Date = new Date()): ScheduleOffset {
  return date === addDaysYmd(todayJst(now), 1) ? 1 : 0;
}

/** 起動したときの予定タブの日(URL にリンクがあればその日、無ければ今日)。 */
export function initialScheduleOffset(search: string = window.location.search, now?: Date): ScheduleOffset {
  const date = scheduleLinkDateOf(search);
  return date ? scheduleOffsetForDate(date, now) : 0;
}

/** URL からリンクの問い合わせだけを取り除いた URL(ほかの問い合わせ・# は残す)。リンクが無ければ null。 */
export function urlWithoutScheduleLink(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has(SCHEDULE_LINK_PARAM)) return null;
  url.searchParams.delete(SCHEDULE_LINK_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Service Worker のメッセージが通知を押した知らせなら、開く日付(それ以外は null)。 */
export function scheduleLinkDateOfMessage(data: unknown, origin: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, url } = data as { type?: unknown; url?: unknown };
  if (type !== NOTIFICATION_CLICK_MESSAGE || typeof url !== 'string') return null;
  const target = new URL(url, origin);
  return target.origin === origin ? scheduleLinkDateOf(target.search) : null;
}

type ScheduleLinkListener = (date: string) => void;
const listeners = new Set<ScheduleLinkListener>();

/** 開いている予定タブに日付を知らせる(useScheduleView が受け取る)。 */
export function openScheduleLink(date: string): void {
  for (const listener of listeners) listener(date);
}

export function onScheduleLink(listener: ScheduleLinkListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
