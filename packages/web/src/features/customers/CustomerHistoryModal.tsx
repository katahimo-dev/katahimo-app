import type { CustomerListItem } from '@katahimo/shared';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { FadeModal, ModalFooter, ModalHeader } from '../../ui/modal';
import { HistoryTimelineItem } from './HistoryTimelineItem';
import { useCustomerHistory } from './useCustomerHistory';

/**
 * 「これまでの記録」ダイアログ(GAS版 #customerHistoryModal / showCustomerHistory / renderHistoryTimeline)。
 * 日報(青)・事故報告(赤)・ヒヤリハット(橙)を新しい順に並べ、5件ずつ読み足す。
 */
export function CustomerHistoryModal({
  open,
  customer,
  onClose,
}: {
  open: boolean;
  customer: CustomerListItem | null;
  onClose: () => void;
}) {
  return (
    <FadeModal
      open={open}
      labelledBy="customerHistoryTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4 transition-opacity"
    >
      {/* GAS版は開くときに scale-95 を外して transition-all を足している(お客様の情報とは違う) */}
      <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-2xl flex flex-col transform transition-transform transition-all">
        <ModalHeader
          title="これまでの記録"
          titleId="customerHistoryTitle"
          titleClassName="font-bold text-lg text-gray-800"
          onClose={onClose}
        />
        <div className="p-6 overflow-y-auto space-y-6">
          {customer ? <HistorySection customerId={customer.id} enabled={open} /> : null}
        </div>
        <ModalFooter>
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            閉じる
          </button>
        </ModalFooter>
      </div>
    </FadeModal>
  );
}

function HistorySection({ customerId, enabled }: { customerId: string; enabled: boolean }) {
  const { query, reload } = useCustomerHistory(customerId, enabled);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const firstPageEmpty = query.data !== undefined && items.length === 0;

  return (
    <div id="historySection">
      <h4 className="font-bold text-gray-800 mb-2 flex justify-between items-center gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reload}
            className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold transition-colors"
          >
            🔄 最新にする
          </button>
        </div>
        {query.isFetching ? (
          <span className="text-base font-normal text-gray-600 flex items-center gap-1">
            <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            読み込んでいます…
          </span>
        ) : null}
      </h4>
      <div className="space-y-4 pl-2 border-l-2 border-gray-200 ml-2 relative">
        {firstPageEmpty ? (
          <div className="text-center py-6">
            <div className="text-4xl mb-2">📭</div>
            <div className="text-base text-gray-700">まだ記録がありません</div>
            <div className="text-sm text-gray-600 mt-1">日報を保存するとここに並びます</div>
          </div>
        ) : query.isError && items.length === 0 ? (
          <div className="text-sm text-red-400 py-4 pl-4">{NETWORK_ERROR_MESSAGE}</div>
        ) : (
          items.map((item) => <HistoryTimelineItem key={item.id} item={item} />)
        )}
      </div>
      {query.hasNextPage ? (
        <div className="text-center mt-4">
          <button
            type="button"
            id="loadMoreHistoryBtn"
            onClick={() => void query.fetchNextPage()}
            className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl transition-colors flex items-center gap-2 mx-auto"
          >
            <span>さらに前の記録を見る</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
