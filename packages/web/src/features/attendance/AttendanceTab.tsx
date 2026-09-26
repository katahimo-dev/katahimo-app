import type { CalendarSyncPreviewResponse } from '@katahimo/shared';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { calendarSyncApi } from '../../api/calendarSync';
import { userMessageOf } from '../../api/client';
import { AdminTargetStaffSelect, useAdminTargetStaff } from '../../app/adminTargetStaff';
import { runWhenIdle } from '../../lib/idle';
import { ErrorState } from '../../ui/StatusViews';
import { showErrorToast, showToast } from '../../ui/toast';
import { DayGrid } from './components/DayGrid';
import { DayHeaderRow } from './components/DayHeaderRow';
import { DayStatus } from './components/DayStatus';
import { DayToolbar } from './components/DayToolbar';
import { DetailPanel } from './components/DetailPanel';
import { DAY_HOUR_HEIGHT, gridContainerHeight, WEEK_HOUR_HEIGHT } from './components/gridConstants';
import { LoadingBlock } from './components/LoadingBlock';
import { SlotModal } from './components/SlotModal';
import { WeekGrid } from './components/WeekGrid';
import { WeekList } from './components/WeekList';
import { WeekNav } from './components/WeekNav';
import {
  useAttendanceDay,
  useAttendanceInvalidation,
  useAttendanceTarget,
  useWeekEvents,
} from './hooks/attendanceQueries';
import { useCalendarNav } from './hooks/useCalendarNav';
import { useCalendarRangeSync } from './hooks/useCalendarRangeSync';
import { useSwipeNav } from './hooks/useSwipeNav';
import { type SlotKey, type SlotValues, slotDef, toDayRecord } from './model/dayRecord';
import { sameAsCalendarMessage } from './model/diff';
import { type CalendarEvent, computeHourRange, todayJst, updatedAtLabel } from './model/week';

// あまり使わないダイアログは別のJSに分け、タブを開いて手が空いたときに先に読んでおく
const loadMonthlyModal = () => import('./components/MonthlyModal');
const loadRangeSyncModal = () => import('./components/RangeSyncModal');
const loadCalendarSyncDiffModal = () => import('./components/CalendarSyncDiffModal');
const loadReceiptListModal = () => import('./components/ReceiptListModal');
const MonthlyModal = lazy(() => loadMonthlyModal().then((m) => ({ default: m.MonthlyModal })));
const RangeSyncModal = lazy(() => loadRangeSyncModal().then((m) => ({ default: m.RangeSyncModal })));
const CalendarSyncDiffModal = lazy(() =>
  loadCalendarSyncDiffModal().then((m) => ({ default: m.CalendarSyncDiffModal })),
);
const ReceiptListModal = lazy(() => loadReceiptListModal().then((m) => ({ default: m.ReceiptListModal })));

/**
 * 「🕒 出勤簿」タブ(GAS版 #tabPastSchedule)と、その中のダイアログ(今月のまとめ・まとめて取り込む・
 * カレンダーと違うところ・予定の修正)。GAS版と同じく、初めてタブを開いたときに作られる(AppShell)。
 *
 * 週間予定は出勤簿の記録(カレンダーではない)。日にちを押すと1日表示になり、そこで記録を直す・
 * カレンダーと見比べて取り込むことができる。
 */
interface SlotTarget {
  date: string;
  slotKey: SlotKey;
  /** 読み込み前に先に出す名前・時刻 */
  prefill: SlotValues | null;
}

export function AttendanceTab() {
  const { isAdmin } = useAdminTargetStaff();
  const { staffId } = useAttendanceTarget();
  const nav = useCalendarNav();
  const today = todayJst();
  const isDay = nav.viewMode === 'day';
  const isWeekList = !isDay && nav.weekViewMode === 'list';

  const week = useWeekEvents(nav.weekStart);
  const day = useAttendanceDay(nav.selectedDate);
  const { reloadAfterChange, reloadDayAndWeek } = useAttendanceInvalidation();
  const events = week.data?.events ?? [];

  const [monthlyOpen, setMonthlyOpen] = useState(false);
  /** 今月のまとめは一度開いたら閉じても残す(月の欄の値がGAS版と同じく残る) */
  const [monthlyMounted, setMonthlyMounted] = useState(false);
  /** 領収書の一覧(null = 閉じている)。月は今月のまとめから開いたときはその月 */
  const [receipts, setReceipts] = useState<{ month: string | null } | null>(null);
  const [receiptsMounted, setReceiptsMounted] = useState(false);
  const [rangeSyncOpen, setRangeSyncOpen] = useState(false);
  /** 開くたびに増やして、まとめて取り込むダイアログを作り直す(日付を選んでいる日に戻す) */
  const [rangeSyncKey, setRangeSyncKey] = useState(0);
  const [slotTarget, setSlotTarget] = useState<SlotTarget | null>(null);
  const [diff, setDiff] = useState<{
    preview: CalendarSyncPreviewResponse;
    staffId: string | undefined;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const rangeSync = useCalendarRangeSync({
    onFinished: (allSucceeded) => {
      if (allSucceeded) setRangeSyncOpen(false);
      reloadAfterChange();
    },
  });

  // 初めて週間予定が届くまでは、日付の行を出さず説明も既定の文にする(GAS版は届いてから描いていた)
  const [weekRendered, setWeekRendered] = useState(false);
  if (!weekRendered && week.data) setWeekRendered(true);

  // 読み直している間も、前に読んだ時刻を出したままにする(GAS版 #calWeekUpdatedAt)
  const [weekFetchedAt, setWeekFetchedAt] = useState<number | null>(null);
  if (week.data && week.data.fetchedAt !== weekFetchedAt) setWeekFetchedAt(week.data.fetchedAt);

  // 週間予定を読めなかったときは赤いお知らせも出す(GAS版 loadWeekEvents)
  useEffect(() => {
    if (week.error) showErrorToast(week.error);
  }, [week.error]);

  useEffect(
    () =>
      runWhenIdle(() => {
        void loadMonthlyModal();
        void loadCalendarSyncDiffModal();
        void loadReceiptListModal();
        if (isAdmin) void loadRangeSyncModal();
      }),
    [isAdmin],
  );

  const openMonthly = () => {
    setMonthlyMounted(true);
    setMonthlyOpen(true);
  };
  const openReceipts = (month: string | null) => {
    setReceiptsMounted(true);
    setReceipts({ month });
  };
  /** 取り込み中でなければ前回の進みぐあいを消して開く(GAS版 openCalendarSyncRangeModal) */
  const openRangeSync = () => {
    rangeSync.resetIfIdle();
    setRangeSyncKey((k) => k + 1);
    setRangeSyncOpen(true);
  };

  // 左右のスワイプで週送り(週表示)・日送り(1日表示)。GAS版 setupCalSwipeNav_
  const listRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const onSwipe = (direction: 1 | -1) => (isDay ? nav.moveDay(direction) : nav.moveWeek(direction));
  useSwipeNav(listRef, onSwipe);
  useSwipeNav(gridRef, onSwipe);

  /** いま表示している日・スタッフ(待っている間に切り替えたら、前の結果は出さない) */
  const currentRef = useRef({ date: nav.selectedDate, staffId });
  useEffect(() => {
    currentRef.current = { date: nav.selectedDate, staffId };
  });
  const isStillShowing = (date: string, requestStaffId: string | undefined) =>
    currentRef.current.date === date && currentRef.current.staffId === requestStaffId;

  /** 予定を押したとき: その日の1日表示にしつつ、その予定の修正を開く(GAS版 openScheduleSlotForDate_) */
  const openSlot = (date: string, slotKey: SlotKey, prefill: SlotValues | null) => {
    nav.openDate(date);
    setSlotTarget({ date, slotKey, prefill });
  };
  const openSlotFromEvent = (e: CalendarEvent) =>
    openSlot(e.date, e.slotKey as SlotKey, { name: e.title, start: e.start, end: e.end });

  /**
   * 「🔄 最新にする」: 出勤簿を読み直し、続けてカレンダーと見比べる。違いがあれば「カレンダーと違うところ」を
   * 出す(GAS版 refreshPastScheduleDay)。直せない月の日は読み直すだけ。
   */
  const refreshDay = async () => {
    const date = nav.selectedDate;
    const requestStaffId = staffId;
    setRefreshing(true);
    try {
      const res = await reloadDayAndWeek(date);
      // 読めなかったとき(その場で表示済み)・待つ間に別の日・別のスタッフへ移ったときはここで終わり
      if (!res || !isStillShowing(date, requestStaffId)) return;
      if (!res.editable) {
        showToast('最新にしました');
        return;
      }
      const preview = await calendarSyncApi.preview({ date, staffId: requestStaffId });
      if (!isStillShowing(date, requestStaffId)) return;
      if (!preview.hasChanges) {
        showToast(sameAsCalendarMessage(preview.appointmentCount));
        return;
      }
      setDiff({ preview, staffId: requestStaffId });
    } catch (e) {
      showErrorToast(e);
    } finally {
      setRefreshing(false);
    }
  };

  const dayEvents = events.filter((e) => e.date === nav.selectedDate);
  const hourRange = computeHourRange(isDay ? dayEvents : events);
  const gridHeight =
    week.data && !isWeekList
      ? gridContainerHeight(
          (hourRange.endHour - hourRange.startHour) * (isDay ? DAY_HOUR_HEIGHT : WEEK_HOUR_HEIGHT),
        )
      : undefined;
  const weekStatus = week.isLoading ? (
    <LoadingBlock padding="py-10" />
  ) : week.error ? (
    <ErrorState message={userMessageOf(week.error)} />
  ) : null;

  const dayData = day.data;
  const dayRecord = dayData ? toDayRecord(dayData.rowData) : null;

  return (
    <>
      <AdminTargetStaffSelect id="pastScheduleStaffSelect" />

      <div className="flex flex-wrap gap-3 mb-4">
        <button
          type="button"
          onClick={openMonthly}
          className="flex-1 basis-[40%] min-h-12 py-3 rounded-xl text-base font-bold bg-gray-200 text-gray-800 transition-colors"
        >
          📊 今月のまとめ
        </button>
        <button
          type="button"
          onClick={() => openReceipts(null)}
          className="flex-1 basis-[40%] min-h-12 py-3 rounded-xl text-base font-bold bg-gray-200 text-gray-800 transition-colors"
        >
          🧾 領収書
        </button>
        {isAdmin ? (
          <button
            type="button"
            onClick={openRangeSync}
            className="flex-1 basis-full min-h-12 py-3 rounded-xl text-base font-bold bg-blue-600 text-white transition-colors"
          >
            📅 まとめて取り込む
          </button>
        ) : null}
      </div>

      {/* 週間予定(出勤簿の記録)。予定を押すと直接直せる */}
      <div className="bg-white rounded-2xl border border-gray-200 p-3 mb-4">
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-2.5 py-2 mb-2 leading-snug">
          毎晩、自動で最新になります。今すぐ直したいときは、日にちを押してください。
        </div>
        <WeekNav
          weekStart={nav.weekStart}
          updatedAtLabel={updatedAtLabel(weekFetchedAt)}
          onMoveWeek={nav.moveWeek}
          onToday={nav.jumpToToday}
        />
        {isDay ? (
          <DayToolbar
            refreshing={refreshing}
            onBack={nav.backToWeek}
            onRefresh={() => void refreshDay()}
            editableSlots={dayData?.editable && dayRecord ? dayRecord.slots : null}
            onOpenSlot={(key) => setSlotTarget({ date: nav.selectedDate, slotKey: key, prefill: null })}
          />
        ) : (
          <div id="calWeekViewToggleRow" className="mb-2">
            <button
              type="button"
              onClick={nav.toggleWeekView}
              className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold"
            >
              {isWeekList ? '📋 表で見る' : '📝 一覧で見る'}
            </button>
          </div>
        )}
        <div id="calWeekList" ref={listRef} className={`space-y-3${isWeekList ? '' : ' hidden'}`}>
          {isWeekList
            ? (weekStatus ?? (
                <WeekList
                  weekStart={nav.weekStart}
                  today={today}
                  events={events}
                  onSelectDay={nav.drillToDay}
                />
              ))
            : null}
        </div>
        {/* 日付の行は一覧でも出す(予定の無い日は一覧に出ないため、ここから開く) */}
        <div id="calDayHeaderRow" className="flex">
          {weekRendered ? (
            <DayHeaderRow
              weekStart={nav.weekStart}
              today={today}
              selectedDate={isDay ? nav.selectedDate : null}
              events={events}
              onSelectDay={nav.drillToDay}
            />
          ) : null}
        </div>
        <div
          id="calDayGrid"
          ref={gridRef}
          className={`relative mt-2${isWeekList ? ' hidden' : ''}`}
          style={gridHeight ? { height: gridHeight } : undefined}
        >
          {isWeekList
            ? null
            : (weekStatus ??
              (isDay ? (
                <DayGrid
                  events={dayEvents}
                  startHour={hourRange.startHour}
                  endHour={hourRange.endHour}
                  onSelectEvent={openSlotFromEvent}
                />
              ) : (
                <WeekGrid
                  weekStart={nav.weekStart}
                  events={events}
                  startHour={hourRange.startHour}
                  endHour={hourRange.endHour}
                  onSelectDay={nav.drillToDay}
                  onSelectEvent={openSlotFromEvent}
                />
              )))}
        </div>
        <p className="text-sm text-gray-600 mt-2">
          {isWeekList && weekRendered
            ? '日付を押すと、その日の記録を直せます。予定のない日は上の日付から開けます。'
            : '日付を押すと1日ずつ見られます。予定を押すと内容を直せます。'}
        </p>
      </div>

      {/* 1日表示だけ: 記録の上のお知らせと「移動と距離・買い物代行・備考」 */}
      {isDay ? (
        <>
          <div id="pastScheduleResult">
            <DayStatus day={dayData} isLoading={day.isFetching} error={day.isFetching ? null : day.error} />
          </div>
          {dayData ? (
            <DetailPanel
              key={`${dayData.businessDate}-${day.dataUpdatedAt}`}
              day={dayData}
              staffId={staffId}
              onSaved={reloadAfterChange}
            />
          ) : null}
        </>
      ) : null}

      {/* 分けて読むダイアログは、読み終わる前に別のダイアログを隠さないよう1つずつ Suspense で包む */}
      {monthlyMounted ? (
        <Suspense fallback={null}>
          <MonthlyModal
            open={monthlyOpen}
            onClose={() => setMonthlyOpen(false)}
            onOpenSlot={(date, slotKey, prefill) => openSlot(date, slotKey, prefill)}
            onOpenReceipts={openReceipts}
          />
        </Suspense>
      ) : null}
      {receiptsMounted ? (
        <Suspense fallback={null}>
          <ReceiptListModal
            open={receipts !== null}
            initialMonth={receipts?.month ?? null}
            onClose={() => setReceipts(null)}
          />
        </Suspense>
      ) : null}
      {isAdmin && rangeSyncKey > 0 ? (
        <Suspense fallback={null}>
          <RangeSyncModal
            key={rangeSyncKey}
            open={rangeSyncOpen}
            defaultDate={nav.selectedDate}
            sync={rangeSync}
            onClose={() => setRangeSyncOpen(false)}
          />
        </Suspense>
      ) : null}
      {diff ? (
        <Suspense fallback={null}>
          <CalendarSyncDiffModal
            preview={diff.preview}
            staffId={diff.staffId}
            onClose={() => setDiff(null)}
            onApplied={reloadAfterChange}
          />
        </Suspense>
      ) : null}
      {slotTarget ? (
        <SlotModalForDate
          target={slotTarget}
          staffId={staffId}
          onClose={() => setSlotTarget(null)}
          onSaved={() => {
            setSlotTarget(null);
            reloadAfterChange();
          }}
        />
      ) : null}
    </>
  );
}

/** 予定の修正ダイアログに、その日の出勤簿を読み込んで渡す。読めなければ閉じてお知らせを出す。 */
function SlotModalForDate({
  target,
  staffId,
  onClose,
  onSaved,
}: {
  target: SlotTarget;
  staffId: string | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const day = useAttendanceDay(target.date);
  const failed = day.isError && !day.data;
  const errorMessage = failed ? userMessageOf(day.error) : '';
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!failed) return;
    onCloseRef.current();
    showToast(errorMessage || 'この日の内容を見られませんでした', true);
  }, [failed, errorMessage]);

  return (
    <SlotModal
      def={slotDef(target.slotKey)}
      day={day.data}
      prefill={target.prefill}
      staffId={staffId}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
