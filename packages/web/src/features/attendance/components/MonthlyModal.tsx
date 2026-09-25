import type { AttendanceMonth } from '@katahimo/shared';
import { useState } from 'react';
import { userMessageOf } from '../../../api/client';
import { Modal, ModalFooter, ModalHeader } from '../../../ui/modal';
import { EmptyState } from '../../../ui/StatusViews';
import { showToast } from '../../../ui/toast';
import { useAttendanceInvalidation, useAttendanceMonth } from '../hooks/attendanceQueries';
import type { SlotKey, SlotValues } from '../model/dayRecord';
import { formatKmJa, formatMinutesJa, formatYen } from '../model/format';
import { buildMonthlyDayCards, type MonthlyDayCard, receiptRows } from '../model/monthly';
import { dayOfWeekLabel, todayJst, updatedAtLabel } from '../model/week';
import { LoadingBlock } from './LoadingBlock';

/**
 * 「📊 今月のまとめ（出勤簿・領収書）」(GAS版 #attendanceMonthlyModal / loadAttendanceMonthly /
 * renderAttendanceMonthly)。月を選んで「見る」で読み(2時間キャッシュ)、「🔄 最新にする」で読み直す。
 * 日のカードを押すと、その日の最初の予定の修正を開く。
 */
export function MonthlyModal({
  open,
  onClose,
  onOpenSlot,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSlot: (date: string, slotKey: SlotKey, prefill: SlotValues) => void;
}) {
  // 月の欄・読んだ月は閉じても残す(GAS版は開き直しても前の値のまま)
  const [monthInput, setMonthInput] = useState('');
  const [requestedMonth, setRequestedMonth] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  const { reloadMonth } = useAttendanceInvalidation();
  const monthQuery = useAttendanceMonth(requestedMonth);
  // 一度でも結果を出したら、中身の入れ物を左寄せにする(GAS版は最初の案内文の中央寄せのまま読み込み中を出す)
  const [rendered, setRendered] = useState(false);
  if (!rendered && (monthQuery.isSuccess || monthQuery.isError)) setRendered(true);
  // 読み直している間も、前に読んだ時刻を出したままにする
  const [lastTs, setLastTs] = useState<number | null>(null);
  if (monthQuery.data && monthQuery.data.ts !== lastTs) setLastTs(monthQuery.data.ts);

  // 開くたびに選んでいる月(空なら今月)を読む(GAS版 openAttendanceMonthlyModal → loadAttendanceMonthly)
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const ym = monthInput || todayJst().slice(0, 7);
      setMonthInput(ym);
      setRequestedMonth(ym);
    }
  }

  const load = (force: boolean) => {
    if (!monthInput) {
      showToast('月を選んでください', true);
      return;
    }
    setRequestedMonth(monthInput);
    if (force) reloadMonth(monthInput);
  };

  const onSelectDay = (card: MonthlyDayCard) => {
    if (!card.firstSlot) {
      showToast('この日は直せる予定がありません', true);
      return;
    }
    onOpenSlot(card.date, card.firstSlot.def.key, card.firstSlot.values);
  };

  return (
    <Modal
      transition="none"
      onClose={onClose}
      open={open}
      labelledBy="attendanceMonthlyTitle"
      className="fixed inset-0 bg-black bg-opacity-50 z-[110] flex items-center justify-center p-4"
    >
      <div className="bg-white w-full max-w-lg rounded-2xl border border-gray-200 flex flex-col max-h-[90vh]">
        <ModalHeader
          title="📊 今月のまとめ（出勤簿・領収書）"
          titleId="attendanceMonthlyTitle"
          onClose={onClose}
        />
        <div className="p-4 space-y-3 overflow-y-auto">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label
                htmlFor="attendanceMonthlyMonth"
                className="block text-base font-bold text-gray-700 mb-1"
              >
                月を選ぶ
              </label>
              <input
                type="month"
                id="attendanceMonthlyMonth"
                value={monthInput}
                onChange={(e) => setMonthInput(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-xl text-base"
              />
            </div>
            <button
              type="button"
              onClick={() => load(false)}
              className="min-h-12 py-3 px-4 bg-blue-600 text-white text-base font-bold rounded-xl"
            >
              見る
            </button>
            <button
              type="button"
              onClick={() => load(true)}
              className="min-h-12 py-3 px-3 bg-gray-200 rounded-xl text-sm font-bold text-gray-800 whitespace-nowrap"
            >
              🔄 最新にする
            </button>
          </div>
          <div className="text-sm text-gray-600">{updatedAtLabel(lastTs)}</div>
          <MonthlyContent
            rendered={rendered}
            isLoading={monthQuery.isLoading}
            error={monthQuery.error}
            month={monthQuery.data?.value}
            onSelectDay={onSelectDay}
          />
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
    </Modal>
  );
}

function MonthlyContent({
  rendered,
  isLoading,
  error,
  month,
  onSelectDay,
}: {
  rendered: boolean;
  isLoading: boolean;
  error: unknown;
  month: AttendanceMonth | undefined;
  onSelectDay: (card: MonthlyDayCard) => void;
}) {
  const className = rendered
    ? 'text-base text-gray-800 text-left'
    : 'text-base text-gray-600 py-6 text-center';
  const body = isLoading ? (
    <LoadingBlock padding="py-6" />
  ) : error ? (
    <div className="text-center text-red-600 text-base py-6">{userMessageOf(error)}</div>
  ) : month ? (
    <MonthlySummary month={month} onSelectDay={onSelectDay} />
  ) : (
    '月を選んで「見る」を押してください。'
  );
  return <div className={className}>{body}</div>;
}

function MonthlySummary({
  month,
  onSelectDay,
}: {
  month: AttendanceMonth;
  onSelectDay: (card: MonthlyDayCard) => void;
}) {
  const t = month.totals;
  const cards = buildMonthlyDayCards(month, dayOfWeekLabel);
  const receipts = receiptRows(month);
  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
        <div className="text-base text-gray-700">
          {month.staffName} さん ／ {month.yearMonth}
        </div>
        <div className="text-base font-bold text-gray-700 mt-2">働いた時間</div>
        <div className="text-2xl font-bold text-blue-800 leading-tight">
          {formatMinutesJa(t.workedMinutes)}
        </div>
        <div className="text-base text-gray-700 mt-1">
          うち 所定内（10〜17時） {formatMinutesJa(t.laborMinutes || 0)} ／ 残業{' '}
          {formatMinutesJa(t.overtimeMinutes || 0)}
        </div>
        <div className="text-base text-gray-700 mt-1">
          移動 {formatMinutesJa(t.totalMoveMin || 0)} ／ 距離 {formatKmJa(t.totalDistanceKm || 0)} ／ 超過{' '}
          {Number(t.overThresholdCount || 0)}回
        </div>
        <div className="text-base font-bold text-gray-800 mt-2">
          今月の領収書 合計 {formatYen(Number(month.receipts.total || 0))}
        </div>
      </div>
      <div className="space-y-3 mt-3">
        {cards.length === 0 ? (
          <EmptyState
            icon="📭"
            title="この月の記録はありません"
            hint="日にちを押して記録を足せます（「閉じる」を押して、週の一覧から日にちを選んでください）。"
          />
        ) : (
          cards.map((card) => <MonthlyDayCardView key={card.date} card={card} onSelect={onSelectDay} />)
        )}
      </div>
      <div className="mt-4 border-t pt-3">
        <div className="font-bold text-gray-800 text-base mb-1">領収書</div>
        {receipts.length === 0 ? (
          <div className="text-base text-gray-600 py-2">登録なし</div>
        ) : (
          receipts.map((r) => (
            <div
              key={r.date}
              className="flex items-center justify-between gap-3 py-1 border-b border-gray-100"
            >
              <span className="text-base text-gray-700">{r.date}</span>
              <span className="text-base font-bold text-gray-800">{formatYen(r.amount)}</span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

function MonthlyDayCardView({
  card,
  onSelect,
}: {
  card: MonthlyDayCard;
  onSelect: (card: MonthlyDayCard) => void;
}) {
  const d = card.derived;
  return (
    <button
      type="button"
      onClick={() => onSelect(card)}
      className="w-full text-left min-h-12 flex items-start gap-3 p-3 rounded-xl bg-white border border-gray-200 active:bg-blue-50"
    >
      <div className="flex-shrink-0 w-10 text-center">
        <div className="text-xl font-bold text-gray-800 leading-tight">{card.day}</div>
        <div className="text-sm text-gray-600 leading-tight">{card.dow}</div>
      </div>
      <div className="flex-grow min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-base text-gray-700">働いた時間</span>
          <span className="text-base font-bold text-gray-900 whitespace-nowrap">
            {formatMinutesJa(d.workedMinutes)}
          </span>
        </div>
        <div className="text-sm text-gray-700 mt-0.5">
          所定内 {formatMinutesJa(d.laborMinutes)} ／ 残業 {formatMinutesJa(d.overtimeMinutes)} ／ 移動{' '}
          {formatMinutesJa(d.totalMoveMin)} ／ {formatKmJa(d.totalDistanceKm)}
        </div>
        <div className="text-base text-gray-800 mt-0.5 truncate">
          {card.names || '（お客様・内容の記入なし）'}
        </div>
        {card.overThresholdCount > 0 ? (
          <div className="mt-1">
            <span className="inline-block bg-red-50 text-red-700 text-sm font-bold rounded px-2 py-0.5">
              ⚠️ 超過 {card.overThresholdCount}回
            </span>
          </div>
        ) : null}
      </div>
    </button>
  );
}
