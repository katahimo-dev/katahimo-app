import type { ReceiptListItem } from '@katahimo/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { userMessageOf } from '../../../api/client';
import { type ReceiptListFilters, receiptsApi } from '../../../api/receipts';
import { useAdminTargetStaff } from '../../../app/adminTargetStaff';
import { BUSINESS_TIME_ZONE, todayJst } from '../../../lib/date';
import { Modal, ModalFooter, ModalHeader } from '../../../ui/modal';
import { EmptyState, ErrorState, Loading } from '../../../ui/StatusViews';
import {
  ALL_STAFF,
  formatReceiptDateTime,
  receiptAmountLabel,
  receiptCustomerLabel,
  receiptSummaryLabel,
} from '../model/receiptList';

/** 領収書の一覧のクエリキー(領収書を送ったら ['receipts'] ごと読み直す)。 */
export const receiptListKeys = {
  all: ['receipts'] as const,
  list: (filters: ReceiptListFilters) => ['receipts', 'list', filters] as const,
};

/**
 * 「🧾 領収書」: 月の領収書の一覧と画像(GAS版では管理者が「領収書一覧」シートと Drive で見ていたもの)。
 * 本人の分を見る。管理者・コーディネーターは「表示するスタッフ」を選び直せ、「全員」も選べる(サーバーも同じ判定)。
 * 画像は見えたところから読み(loading="lazy")、押すと大きく出す。管理者・コーディネーターは CSV で保存できる。
 */
export function ReceiptListModal({
  open,
  initialMonth,
  onClose,
}: {
  open: boolean;
  /** 開いたときの月(今月のまとめから開いたときはその月) */
  initialMonth: string | null;
  onClose: () => void;
}) {
  const { isAdmin, staffList, targetStaffId, requestStaffList } = useAdminTargetStaff();
  const [month, setMonth] = useState(initialMonth ?? todayJst().slice(0, 7));
  const [staffChoice, setStaffChoice] = useState(targetStaffId);
  const [viewing, setViewing] = useState<ReceiptListItem | null>(null);

  // 開くたびに、呼び出し側の月・「表示するスタッフ」に合わせる
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMonth(initialMonth ?? todayJst().slice(0, 7));
      setStaffChoice(targetStaffId);
      setViewing(null);
    }
  }
  useEffect(() => {
    if (open && isAdmin) requestStaffList();
  }, [open, isAdmin, requestStaffList]);

  const filters: ReceiptListFilters = !isAdmin
    ? { month }
    : staffChoice === ALL_STAFF
      ? { month, allStaff: true }
      : { month, staffId: staffChoice };

  return (
    <Modal
      transition="none"
      onClose={onClose}
      open={open}
      labelledBy="receiptListTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[115] flex items-center justify-center p-4"
    >
      <div className="bg-white w-full max-w-lg rounded-2xl border border-gray-200 flex flex-col max-h-[90vh]">
        <ModalHeader title="🧾 領収書" titleId="receiptListTitle" onClose={onClose} />
        <div className="p-4 space-y-3 overflow-y-auto">
          <div>
            <label htmlFor="receiptListMonth" className="block text-base font-bold text-gray-700 mb-1">
              月を選ぶ
            </label>
            <input
              type="month"
              id="receiptListMonth"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
              className="w-full p-3 border border-gray-300 rounded-xl text-base"
            />
          </div>
          {isAdmin ? (
            <div>
              <label htmlFor="receiptListStaff" className="block text-base font-bold text-gray-700 mb-1">
                表示するスタッフ
              </label>
              <select
                id="receiptListStaff"
                value={staffChoice}
                onChange={(e) => setStaffChoice(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-xl text-base focus:ring-2 focus:ring-blue-500"
              >
                <option value={ALL_STAFF}>全員</option>
                {staffList.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {open ? (
            <ReceiptListContent filters={filters} showStaff={filters.allStaff === true} onView={setViewing} />
          ) : null}
        </div>
        <ModalFooter className="flex justify-end gap-3">
          {isAdmin ? (
            <a
              href={receiptsApi.csvUrl(filters)}
              download
              className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
            >
              ⬇ CSVで保存
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            閉じる
          </button>
        </ModalFooter>
      </div>
      <ReceiptImageModal item={viewing} onClose={() => setViewing(null)} />
    </Modal>
  );
}

function ReceiptListContent({
  filters,
  showStaff,
  onView,
}: {
  filters: ReceiptListFilters;
  showStaff: boolean;
  onView: (item: ReceiptListItem) => void;
}) {
  const list = useInfiniteQuery({
    queryKey: receiptListKeys.list(filters),
    queryFn: ({ pageParam, signal }) => receiptsApi.list(filters, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 開くたびに最新を読む(送ったばかりの領収書も出るように)
    staleTime: 0,
  });
  if (list.isPending) return <Loading />;
  if (list.isError) return <ErrorState message={userMessageOf(list.error)} />;
  const first = list.data.pages[0];
  const receipts = list.data.pages.flatMap((p) => p.receipts);
  const timeZone = first?.timeZone ?? BUSINESS_TIME_ZONE;
  return (
    <>
      {first ? (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <div className="text-base text-gray-700">
            {first.staff ? `${first.staff.name} さん` : '全員'} ／ {first.yearMonth}
          </div>
          <div className="text-xl font-bold text-blue-800 mt-1">{receiptSummaryLabel(first.summary)}</div>
        </div>
      ) : null}
      {receipts.length === 0 ? (
        <EmptyState icon="🧾" title="この月の領収書はありません" />
      ) : (
        <ul className="space-y-2" aria-label="領収書の一覧">
          {receipts.map((item) => (
            <ReceiptRow key={item.id} item={item} timeZone={timeZone} showStaff={showStaff} onView={onView} />
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <button
          type="button"
          onClick={() => void list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
          className="w-full min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
        >
          {list.isFetchingNextPage ? '読み込んでいます…' : 'もっと見る'}
        </button>
      ) : null}
    </>
  );
}

function ReceiptRow({
  item,
  timeZone,
  showStaff,
  onView,
}: {
  item: ReceiptListItem;
  timeZone: string;
  showStaff: boolean;
  onView: (item: ReceiptListItem) => void;
}) {
  const when = formatReceiptDateTime(item.receiptedAt, timeZone);
  return (
    <li>
      <button
        type="button"
        onClick={() => onView(item)}
        className="w-full text-left min-h-12 flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-200 active:bg-blue-50"
      >
        <ReceiptThumbnail item={item} alt={`領収書の画像(${when})`} />
        <div className="flex-grow min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-base text-gray-700">{when}</span>
            <span className="text-base font-bold text-gray-900 whitespace-nowrap">
              {receiptAmountLabel(item.amountYen)}
            </span>
          </div>
          <div className="text-base text-gray-800 truncate">{item.storeName || '(店名なし)'}</div>
          <div className="text-sm text-gray-700 truncate">
            {showStaff ? `${item.staffName ?? '(削除されたスタッフ)'} ／ ` : ''}
            {receiptCustomerLabel(item)}
          </div>
          {item.handoffText ? (
            <div className="text-sm text-gray-600 mt-0.5 line-clamp-2 break-words">📝 {item.handoffText}</div>
          ) : null}
        </div>
      </button>
    </li>
  );
}

/** 小さい画像。見えたところから読む。読めなければ「画像なし」。 */
function ReceiptThumbnail({ item, alt }: { item: ReceiptListItem; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex-shrink-0 w-16 h-16 rounded-lg bg-gray-100 text-gray-600 text-sm flex items-center justify-center">
        画像なし
      </div>
    );
  }
  return (
    <img
      src={receiptsApi.imageUrl(item.id)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="flex-shrink-0 w-16 h-16 rounded-lg bg-gray-100 object-cover"
    />
  );
}

/** 押した領収書の画像を大きく出す。 */
function ReceiptImageModal({ item, onClose }: { item: ReceiptListItem | null; onClose: () => void }) {
  const [failedId, setFailedId] = useState<string | null>(null);
  return (
    <Modal
      transition="none"
      open={item !== null}
      onClose={onClose}
      labelledBy="receiptImageTitle"
      className="fixed inset-0 bg-black bg-opacity-80 z-[120] flex items-center justify-center p-4"
    >
      {item ? (
        <div className="bg-white w-full max-w-lg rounded-2xl flex flex-col max-h-[95vh]">
          <ModalHeader
            title={`${receiptAmountLabel(item.amountYen)} ${item.storeName ?? ''}`}
            titleId="receiptImageTitle"
            onClose={onClose}
          />
          <div className="p-2 overflow-auto flex-grow flex items-center justify-center bg-gray-900">
            {failedId === item.id ? (
              <div className="text-white text-base py-10">画像を読めませんでした</div>
            ) : (
              <img
                src={receiptsApi.imageUrl(item.id)}
                alt="領収書の画像"
                onError={() => setFailedId(item.id)}
                className="max-w-full max-h-[70vh] object-contain"
              />
            )}
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
      ) : null}
    </Modal>
  );
}
