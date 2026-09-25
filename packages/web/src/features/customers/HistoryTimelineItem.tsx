import type { CustomerHistoryItem } from '@katahimo/shared';
import { useState } from 'react';
import { type HistoryTab, historyBadge, ratingStars, splitHistoryTimestamp } from './historyFormat';

const TAB_ACTIVE =
  'min-h-11 px-3 py-2 rounded-t font-bold bg-white border-x border-t border-gray-200 text-blue-600';
const TAB_INACTIVE = 'min-h-11 px-3 py-2 rounded-t text-gray-700 active:bg-gray-200 transition-colors';

/**
 * 「これまでの記録」の1件(GAS版 renderHistoryTimeline の1件と switchReportTab)。
 * 最初は「事務局に送る文」を出す。事故報告には「保護者に送る文」のタブは無い。
 */
export function HistoryTimelineItem({ item }: { item: CustomerHistoryItem }) {
  const [tab, setTab] = useState<HistoryTab>('internal');
  const isAccident = item.type === 'accident';
  const { title, colorClass } = historyBadge(item);
  const { date, time } = splitHistoryTimestamp(item.timestamp);
  const psi = ratingStars(item.risk);
  const es = ratingStars(item.es);

  const tabs: Array<{ key: HistoryTab; label: string }> = [
    { key: 'original', label: '書いたメモ' },
    { key: 'internal', label: '事務局に送る文' },
    ...(isAccident ? [] : [{ key: 'customer' as const, label: '保護者に送る文' }]),
  ];
  const contents: Record<HistoryTab, string> = {
    original: item.original,
    internal: item.internal,
    customer: item.customer,
  };

  return (
    <div className="relative pl-6 pb-6 group transition-all duration-300">
      <div
        className={`absolute -left-[9px] top-1 w-5 h-5 rounded-full border-4 border-white ${colorClass} shadow-sm z-10`}
      />
      <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 shadow-sm transition-shadow">
        <div className="flex justify-between items-start mb-2">
          <div className="flex-grow flex flex-wrap items-center gap-y-1">
            <span className={`text-sm font-bold text-white px-2 py-0.5 rounded ${colorClass} mr-2`}>
              {title}
            </span>
            <span className="text-sm font-bold text-gray-700">{date}</span>
            <span className="text-sm text-gray-500 ml-1 mr-2">{time}</span>
            {psi ? (
              <span className="text-sm font-bold bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200 whitespace-nowrap mr-1">
                PSI:{psi}
              </span>
            ) : null}
            {es ? (
              <span className="text-sm font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded border border-blue-200 whitespace-nowrap">
                ES:{es}
              </span>
            ) : null}
          </div>
          <div className="text-sm text-gray-600 flex items-center gap-1 flex-shrink-0">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
            {item.staff || '不明'}
          </div>
        </div>

        <div className="flex space-x-1 mb-2 border-b border-gray-200 text-sm">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className={tab === t.key ? TAB_ACTIVE : TAB_INACTIVE}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="text-sm text-gray-700 leading-relaxed min-h-[60px]">
          <div className="whitespace-pre-wrap">{contents[tab] || '(なし)'}</div>
        </div>
      </div>
    </div>
  );
}
