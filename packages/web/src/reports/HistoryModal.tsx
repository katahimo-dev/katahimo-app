import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { HistoryItem } from '../api';
import { fetchCustomerHistory } from '../api';

/**
 * 顧客の活動記録(過去の日報+事故報告)タイムライン。GAS版index.htmlのcustomerHistoryModal
 * (「活動記録」ボタンで開く別モーダル)に対応。GAS版と同じくカーソルページネーション
 * (「もっと見る」ボタンでoccurredAtより古いものを追加取得)にしている。
 */
export function HistoryModal({
  customerId,
  customerName,
  onClose,
}: {
  customerId: string;
  customerName: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialQuery = useQuery({
    queryKey: ['customerHistory', customerId, 'initial'],
    queryFn: () => fetchCustomerHistory(customerId),
  });

  if (initialQuery.isSuccess && !loadedOnce) {
    setLoadedOnce(true);
    setItems(initialQuery.data);
    setHasMore(initialQuery.data.length >= 5);
  }

  const loadMore = async () => {
    const last = items[items.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setError(null);
    try {
      const more = await fetchCustomerHistory(customerId, last.occurredAtIso);
      setItems((prev) => [...prev, ...more]);
      setHasMore(more.length >= 5);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-md h-[90vh] sm:h-auto sm:max-h-[85vh] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-2xl">
          <div>
            <h2 className="font-bold text-lg text-gray-800">過去の活動記録</h2>
            <p className="text-xs text-gray-500">{customerName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full text-gray-500 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-4">
          {initialQuery.isPending && (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
            </div>
          )}
          {initialQuery.isError && (
            <p className="text-red-500 text-sm">{(initialQuery.error as Error).message}</p>
          )}

          {loadedOnce && items.length === 0 && (
            <p className="text-center text-gray-400 py-8">活動記録はまだありません</p>
          )}

          <div className="space-y-4 pl-2 border-l-2 border-gray-200 ml-2 relative">
            {items.map((item) => (
              <div key={item.id} className="relative pl-4">
                <span
                  className={`absolute -left-[9px] top-1 w-3 h-3 rounded-full ${
                    item.type === 'accident' ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                />
                <div className="bg-gray-50 rounded-lg p-3 text-sm">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="font-bold text-gray-700">
                      {item.type === 'accident' ? `⚠️ ${item.subtype ?? '事故報告'}` : '📝 保育日報'}
                    </span>
                    <span className="text-xs text-gray-400">{item.timestamp}</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-1">担当: {item.staff}</p>
                  {(item.risk || item.es) && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {item.risk ? (
                        <span className="text-xs font-bold bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200 whitespace-nowrap">
                          PSI:{'★'.repeat(item.risk)}
                          {'☆'.repeat(5 - item.risk)}
                        </span>
                      ) : null}
                      {item.es ? (
                        <span className="text-xs font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-200 whitespace-nowrap">
                          ES:{'★'.repeat(item.es)}
                          {'☆'.repeat(5 - item.es)}
                        </span>
                      ) : null}
                    </div>
                  )}
                  <p className="whitespace-pre-wrap text-gray-800">{item.internal}</p>
                </div>
              </div>
            ))}
          </div>

          {error && <p className="text-red-500 text-sm mt-3">{error}</p>}

          {loadedOnce && hasMore && items.length > 0 && (
            <div className="text-center mt-4">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-60"
              >
                {loadingMore ? '読み込み中…' : 'もっと見る'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
