import type { CustomerListItem } from '@katahimo/shared';

/**
 * お客様の1件(GAS版 renderCustomers)。カード全体を押せるようにすると、どこを押したら何が起きるか
 * 分からないため、やることをボタンとして並べる。
 */
export function CustomerCard({
  customer,
  onWriteReport,
  onShowDetail,
  onShowHistory,
}: {
  customer: CustomerListItem;
  onWriteReport: () => void;
  onShowDetail: () => void;
  onShowHistory: () => void;
}) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-200">
      <div className="flex items-baseline gap-2 flex-wrap mb-3">
        <h3 className="font-bold text-gray-800 text-lg">{customer.name}</h3>
        <span className="text-sm text-gray-600">{customer.city ?? ''}</span>
      </div>
      <button
        type="button"
        onClick={onWriteReport}
        className="w-full min-h-12 py-3 rounded-xl bg-blue-600 text-white text-base font-bold transform transition-transform active:scale-95"
      >
        ✏️ 日報を書く
      </button>
      <div className="flex gap-3 mt-3">
        <button
          type="button"
          onClick={onShowDetail}
          className="flex-1 min-h-11 px-3 py-2 text-sm font-bold text-gray-800 bg-gray-200 rounded-xl transition-colors"
        >
          👤 お客様の情報
        </button>
        <button
          type="button"
          onClick={onShowHistory}
          className="flex-1 min-h-11 px-3 py-2 text-sm font-bold text-gray-800 bg-gray-200 rounded-xl transition-colors"
        >
          📖 これまでの記録
        </button>
      </div>
    </div>
  );
}
