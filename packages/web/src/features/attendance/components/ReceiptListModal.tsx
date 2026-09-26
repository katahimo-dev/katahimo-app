import {
  formatZonedDateTime,
  RECEIPT_BILLING_LABELS,
  RECEIPT_CANCEL_REASON_MAX_LENGTH,
  type ReceiptListItem,
} from '@katahimo/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, userMessageOf } from '../../../api/client';
import { queryKeys } from '../../../api/queryKeys';
import { type ReceiptListFilters, receiptsApi } from '../../../api/receipts';
import { useAdminTargetStaff } from '../../../app/adminTargetStaff';
import { BUSINESS_TIME_ZONE, todayJst } from '../../../lib/date';
import { useFileDownload } from '../../../lib/useFileDownload';
import { Modal, ModalFooter, ModalHeader } from '../../../ui/modal';
import { EmptyState, ErrorState, Loading } from '../../../ui/StatusViews';
import { showErrorToast, showToast } from '../../../ui/toast';
import { useSession } from '../../auth/session';
import { forgetSentReceipt, loadReceiptKeyMap, saveReceiptKeyMap } from '../../report/model/receiptDedup';
import { useAttendanceInvalidation } from '../hooks/attendanceQueries';
import {
  ALL_STAFF,
  formatReceiptDateTime,
  receiptAmountLabel,
  receiptBreakdownLabels,
  receiptCancellationLabel,
  receiptCustomerLabel,
  receiptSummaryLabel,
} from '../model/receiptList';

/** 取消を確かめている領収書(日時の表示に一覧のタイムゾーンを使う)。 */
interface CancelTarget {
  item: ReceiptListItem;
  timeZone: string;
}

/** 領収書の一覧のクエリキー(領収書を送ったら queryKeys.receipts.all ごと読み直す。report の useReceipts)。 */
const receiptListKeys = {
  list: (filters: ReceiptListFilters) => [...queryKeys.receipts.all, 'list', filters] as const,
};

/**
 * 「🧾 領収書」: 月の領収書の一覧と画像(GAS版では管理者が「領収書一覧」シートと Drive で見ていたもの)。
 * 本人の分を見る。管理者・コーディネーターは「表示するスタッフ」を選び直せ、「全員」も選べる(サーバーも同じ判定)。
 * 画像は見えたところから読み(loading="lazy")、押すと大きく出す。管理者・コーディネーターは CSV で保存できる。
 * 会社負担の領収書には印を付ける。取消せる領収書(サーバーが行ごとに cancellable で返す)には「取消」を出し、
 * 取消した領収書は灰色で残す(合計には入らない)。
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
  const [cancelling, setCancelling] = useState<CancelTarget | null>(null);
  const csv = useFileDownload<'csv'>();

  // 開くたびに、呼び出し側の月・「表示するスタッフ」に合わせる
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMonth(initialMonth ?? todayJst().slice(0, 7));
      setStaffChoice(targetStaffId);
      setViewing(null);
      setCancelling(null);
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
            <ReceiptListContent
              filters={filters}
              showStaff={filters.allStaff === true}
              onView={setViewing}
              onCancel={setCancelling}
            />
          ) : null}
        </div>
        <ModalFooter className="flex justify-end gap-3">
          {isAdmin ? (
            // 断られたら理由を赤いお知らせで出す(理由の JSON をファイルにしない)
            <button
              type="button"
              disabled={csv.busy !== null}
              onClick={() =>
                void csv.run('csv', () => receiptsApi.downloadCsv(filters), 'CSVファイルを保存しました')
              }
              className="min-h-12 px-4 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl disabled:opacity-50"
            >
              {csv.busy ? '保存しています…' : '⬇ CSVで保存'}
            </button>
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
      <ReceiptCancelModal target={cancelling} onClose={() => setCancelling(null)} />
    </Modal>
  );
}

function ReceiptListContent({
  filters,
  showStaff,
  onView,
  onCancel,
}: {
  filters: ReceiptListFilters;
  showStaff: boolean;
  onView: (item: ReceiptListItem) => void;
  onCancel: (target: CancelTarget) => void;
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
          {receiptBreakdownLabels(first.summary).map((label) => (
            <div key={label} className="text-base text-gray-700 mt-1">
              {label}
            </div>
          ))}
        </div>
      ) : null}
      {receipts.length === 0 ? (
        <EmptyState icon="🧾" title="この月の領収書はありません" />
      ) : (
        <ul className="space-y-2" aria-label="領収書の一覧">
          {receipts.map((item) => (
            <ReceiptRow
              key={item.id}
              item={item}
              timeZone={timeZone}
              showStaff={showStaff}
              onView={onView}
              onCancel={onCancel}
            />
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
  onCancel,
}: {
  item: ReceiptListItem;
  timeZone: string;
  showStaff: boolean;
  onView: (item: ReceiptListItem) => void;
  onCancel: (target: CancelTarget) => void;
}) {
  const when = formatReceiptDateTime(item.receiptedAt, timeZone);
  const cancelled = item.cancellation !== null;
  return (
    <li className={`rounded-xl border border-gray-200 ${cancelled ? 'bg-gray-100' : 'bg-white'}`}>
      <button
        type="button"
        onClick={() => onView(item)}
        className={`w-full text-left min-h-12 flex items-start gap-3 p-3 rounded-xl ${
          cancelled ? 'opacity-60 active:bg-gray-200' : 'active:bg-blue-50'
        }`}
      >
        <ReceiptThumbnail item={item} alt={`領収書の画像(${when})`} />
        <div className="flex-grow min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-base text-gray-700">{when}</span>
            <span
              className={`text-base font-bold whitespace-nowrap ${cancelled ? 'line-through' : ''} text-gray-900`}
            >
              {receiptAmountLabel(item.amountYen)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            {cancelled ? (
              <span className="inline-block bg-gray-600 text-white text-sm font-bold rounded px-2 py-0.5">
                取消
              </span>
            ) : null}
            {item.companyPaid ? (
              <span className="inline-block bg-amber-100 text-amber-900 text-sm font-bold rounded px-2 py-0.5">
                {RECEIPT_BILLING_LABELS.company}
              </span>
            ) : null}
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
      {item.cancellation ? (
        <div className="px-3 pb-3 text-sm text-gray-700 break-words">
          <div>{receiptCancellationLabel(item.cancellation, timeZone)}</div>
          {item.cancellation.reason ? <div>理由: {item.cancellation.reason}</div> : null}
        </div>
      ) : item.cancellable ? (
        <div className="px-3 pb-3 flex justify-end">
          <button
            type="button"
            onClick={() => onCancel({ item, timeZone })}
            aria-label={`取消(${when} ${receiptAmountLabel(item.amountYen)})`}
            className="min-h-11 px-4 py-2 bg-white border border-red-300 text-red-700 text-base font-bold rounded-xl active:bg-red-50"
          >
            取消
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * 「取消」の確かめ(理由は任意の1行)。取消したら一覧・今月のまとめを読み直し、本人の領収書ならこの端末の
 * 「送った領収書の印」も消す(同じ領収書を送り直せるように。印は送った人の名前ごとに残るため、他のスタッフの
 * 領収書の取消では消さない)。取消済み・他の人が先に変えた(409)・取消せる期間を過ぎた(400 locked)ときも
 * 一覧・今月のまとめを読み直す。二重に押しても1回だけ送る。
 */
function ReceiptCancelModal({ target, onClose }: { target: CancelTarget | null; onClose: () => void }) {
  const item = target?.item ?? null;
  const timeZone = target?.timeZone ?? BUSINESS_TIME_ZONE;
  const queryClient = useQueryClient();
  const { reloadMonths } = useAttendanceInvalidation();
  const { user } = useSession();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // 同じ描画の中で2回押された(Enter と「取消す」等)ときも1回だけ送る(busy は次の描画まで変わらない)
  const submittingRef = useRef(false);
  const [shownId, setShownId] = useState<string | null>(null);
  if ((item?.id ?? null) !== shownId) {
    setShownId(item?.id ?? null);
    setReason('');
  }

  const reloadAll = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.receipts.all });
    reloadMonths();
  };

  const submit = async () => {
    if (!item || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      await receiptsApi.cancel(item.id, { reason, rowVersion: item.rowVersion });
      // 印はこの端末から送った人(ログインしている人)の名前で残る(useReceipts)
      if (item.staffId === user.staffId) {
        const now = Date.now();
        saveReceiptKeyMap(
          user.name,
          forgetSentReceipt(loadReceiptKeyMap(user.name, now), {
            receiptedAt: formatZonedDateTime(item.receiptedAt, timeZone).replaceAll('-', '/'),
            customerId: item.customerId,
            amountYen: item.amountYen,
            storeName: item.storeName,
          }),
          now,
        );
      }
      showToast('領収書を取消しました');
      reloadAll();
      onClose();
    } catch (e) {
      showErrorToast(e);
      // 先に取消された・期間を過ぎた等は、一覧も今月のまとめも今の状態に読み直す
      if (e instanceof ApiRequestError && (e.code === 'conflict' || e.code === 'locked')) {
        reloadAll();
        onClose();
      }
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Modal
      transition="none"
      open={item !== null}
      onClose={onClose}
      role="alertdialog"
      labelledBy="receiptCancelTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[120] flex items-center justify-center p-4"
    >
      {item ? (
        <div className="bg-white w-full max-w-sm rounded-2xl p-6 space-y-3">
          <h3 id="receiptCancelTitle" className="font-bold text-lg text-gray-800">
            この領収書を取消しますか？
          </h3>
          <div className="text-base text-gray-700">
            {formatReceiptDateTime(item.receiptedAt, timeZone)} {receiptAmountLabel(item.amountYen)}{' '}
            {item.storeName ?? ''}
          </div>
          <div className="text-sm text-gray-600">
            取消した領収書は一覧に灰色で残り、合計には入りません。直すときは、取消してから登録し直してください。
          </div>
          <div>
            <label htmlFor="receiptCancelReason" className="block text-base font-bold text-gray-700 mb-1">
              取消の理由（あれば）
            </label>
            <input
              id="receiptCancelReason"
              type="text"
              value={reason}
              maxLength={RECEIPT_CANCEL_REASON_MAX_LENGTH}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
              }}
              placeholder="例: 金額を間違えた"
              className="w-full p-3 border border-gray-300 rounded-xl text-base"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
            >
              やめる
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy}
              className="flex-1 min-h-12 py-3 bg-red-600 text-white text-base font-bold rounded-xl disabled:opacity-50"
            >
              {busy ? '取消しています…' : '取消す'}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
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
