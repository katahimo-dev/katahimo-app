import type { CustomerHistoryItem } from '@katahimo/shared';

/** 「これまでの記録」の1件の見出し・色(GAS版 renderHistoryTimeline)。 */
export interface HistoryBadge {
  title: string;
  /** 点と見出しの帯の色: 日報=青、事故報告=赤、ヒヤリハット=橙 */
  colorClass: 'bg-blue-500' | 'bg-red-500' | 'bg-orange-400';
}

export function historyBadge(item: Pick<CustomerHistoryItem, 'type' | 'subtype'>): HistoryBadge {
  if (item.type !== 'accident') return { title: '今日の日報', colorClass: 'bg-blue-500' };
  const title = item.subtype || '事故報告';
  return { title, colorClass: title.includes('ヒヤリ') ? 'bg-orange-400' : 'bg-red-500' };
}

/** 'yyyy/MM/dd HH:mm' → 日付と時刻 */
export function splitHistoryTimestamp(timestamp: string): { date: string; time: string } {
  const [date = '', time = ''] = timestamp.split(' ');
  return { date, time };
}

/** 評価(1〜5)を「★★☆☆☆」にする。評価が無い(0・null)ときは null(バッジを出さない) */
export function ratingStars(value: number | null | undefined): string | null {
  const n = Number(value) || 0;
  if (!n) return null;
  const filled = Math.max(0, Math.min(5, n));
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

/** 1回に読む件数(GAS版 getCustomerReports の limit)。これより少なければ続きは無い */
export const HISTORY_PAGE_SIZE = 5;

export type HistoryTab = 'original' | 'internal' | 'customer';
