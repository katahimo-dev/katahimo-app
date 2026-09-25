import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AttendanceRowData, ScheduleEvent } from '../api';
import { fetchAttendanceDay, fetchAttendanceWeekEvents, saveAttendanceDay } from '../api';
import {
  CAL_DOW,
  CAL_TYPE_STYLE,
  calComputeHourRange,
  calGetWeekStart,
  calTimeToMinutes,
  calYmd,
} from './calendarUtils';
import { MoveDistancePanel } from './MoveDistancePanel';
import { SlotEditModal } from './SlotEditModal';
import { ALL_SLOT_KEYS, SLOT_FIELD_KEYS } from './slotFields';

const CAL_WEEK_HOUR_HEIGHT = 40;
const CAL_DAY_HOUR_HEIGHT = 48;
const CAL_TIME_AXIS_WIDTH = 24;

/**
 * 「勤怠」タブの週間予定表示。GAS版(gas-childcare-visit-app/index.html)の
 * 週間予定(スマホ版Googleカレンダーの週間表示風UI)と同じ見た目・操作感にしている
 * (移行時の混乱を減らすため)。
 *
 * 表示している予定は実際のGoogleカレンダーからではなく、保存済みの出勤簿(attendance_days)
 * の記録をそのままカレンダー風に色分け表示しているだけ(GAS版と同じ設計)。そのため
 * Googleカレンダー連携(Phase 5)が無くても動く。GAS版にあった「📅 カレンダーから取得」
 * (実際のGoogleカレンダーの内容を出勤簿へ反映するボタン)は、その連携が無いため含めていない。
 */
export function AttendanceCalendar({ staffId }: { staffId?: string } = {}) {
  const queryClient = useQueryClient();
  const [weekAnchor, setWeekAnchor] = useState(() => calGetWeekStart(new Date()));
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  const [selectedDate, setSelectedDate] = useState(() => calYmd(new Date()));
  const [openSlotKey, setOpenSlotKey] = useState<ScheduleEvent['slotKey'] | null>(null);
  const [dayRowData, setDayRowData] = useState<AttendanceRowData>({});

  const weekEnd = (() => {
    const d = new Date(weekAnchor);
    d.setDate(d.getDate() + 6);
    return d;
  })();
  const weekStartStr = calYmd(weekAnchor);
  const weekEndStr = calYmd(weekEnd);

  const weekQuery = useQuery({
    queryKey: ['attendance-week', weekStartStr, weekEndStr, staffId],
    queryFn: () => fetchAttendanceWeekEvents(weekStartStr, weekEndStr, staffId),
  });

  const dayQuery = useQuery({
    queryKey: ['attendance-day', selectedDate, staffId],
    queryFn: async () => {
      const result = await fetchAttendanceDay(selectedDate, staffId);
      setDayRowData(result.rowData);
      return result;
    },
    enabled: viewMode === 'day',
  });

  const saveMutation = useMutation({
    mutationFn: (rowData: AttendanceRowData) => saveAttendanceDay(selectedDate, rowData, staffId),
    onSuccess: (result) => {
      setDayRowData(result.rowData);
      queryClient.invalidateQueries({ queryKey: ['attendance-day', selectedDate, staffId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-week', weekStartStr, weekEndStr, staffId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-month'] });
    },
  });

  const weekEvents = weekQuery.data ?? [];
  const todayStr = calYmd(new Date());

  const drillToDay = (dateStr: string) => {
    setSelectedDate(dateStr);
    setViewMode('day');
  };

  const handleSlotSave = (patch: Partial<AttendanceRowData>) => {
    const merged = { ...dayRowData, ...patch };
    setDayRowData(merged);
    saveMutation.mutate(merged);
    setOpenSlotKey(null);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-4">
      <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[11px] rounded-lg px-2.5 py-2 mb-2 leading-snug">
        ⚠️ ここに表示されるのは保存済みの出勤簿の記録です(Googleカレンダー連携はまだ実装されていません)。
      </div>

      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() =>
            setWeekAnchor((prev) => {
              const d = new Date(prev);
              d.setDate(d.getDate() - 7);
              return d;
            })
          }
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
        >
          ‹
        </button>
        <div className="flex flex-col items-center">
          <span className="text-xs font-bold text-gray-700">
            {weekAnchor.getFullYear()}/{weekAnchor.getMonth() + 1}/{weekAnchor.getDate()} 〜{' '}
            {weekEnd.getMonth() + 1}/{weekEnd.getDate()}
          </span>
          <button
            type="button"
            onClick={() => {
              setWeekAnchor(calGetWeekStart(new Date()));
              setSelectedDate(todayStr);
              setViewMode('week');
            }}
            className="text-[11px] text-blue-600 underline mt-0.5"
          >
            今日
          </button>
        </div>
        <button
          type="button"
          onClick={() =>
            setWeekAnchor((prev) => {
              const d = new Date(prev);
              d.setDate(d.getDate() + 7);
              return d;
            })
          }
          className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
        >
          ›
        </button>
      </div>

      {viewMode === 'day' && (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setViewMode('week')}
            className="text-[11px] text-blue-600 underline"
          >
            ← 週間表示に戻る
          </button>
        </div>
      )}

      {/* 日付ボタンの行 */}
      <div className="flex">
        <div className="flex-shrink-0" style={{ width: CAL_TIME_AXIS_WIDTH }} />
        <div className="flex flex-grow gap-0.5">
          {Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekAnchor);
            d.setDate(d.getDate() + i);
            const dateStr = calYmd(d);
            const dayEvents = weekEvents.filter((e) => e.date === dateStr);
            const isSelected = viewMode === 'day' && dateStr === selectedDate;
            const isToday = dateStr === todayStr;
            const baseCls = isSelected
              ? 'bg-blue-600 text-white'
              : isToday
                ? 'bg-blue-50 text-blue-700'
                : 'text-gray-600 hover:bg-gray-50';
            const dotCls =
              dayEvents.length > 0 ? (isSelected ? 'bg-white' : 'bg-blue-500') : 'bg-transparent';
            return (
              <button
                key={dateStr}
                type="button"
                onClick={() => drillToDay(dateStr)}
                className={`flex-1 flex flex-col items-center py-1 rounded-lg transition-colors ${baseCls}`}
              >
                <span className="text-[9px] leading-tight">{CAL_DOW[d.getDay()]}</span>
                <span className="text-xs font-bold leading-tight">{d.getDate()}</span>
                <span className={`w-1 h-1 rounded-full ${dotCls} mt-0.5`} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative mt-2">
        {weekQuery.isPending && (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
          </div>
        )}
        {weekQuery.isError && (
          <p className="text-center text-red-500 text-xs py-8">{weekQuery.error.message}</p>
        )}
        {weekQuery.data &&
          (viewMode === 'week' ? (
            <WeekGrid weekAnchor={weekAnchor} events={weekEvents} onDayClick={drillToDay} />
          ) : (
            <DayGrid date={selectedDate} events={weekEvents} onSlotClick={setOpenSlotKey} />
          ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-2">
        日をタップすると1日表示になります。予定をタップすると内容を編集できます。
      </p>

      {viewMode === 'day' && dayQuery.data && (
        <div className="mt-3 space-y-1">
          <div className="text-xs font-bold text-gray-600 mb-1">✏️ 勤怠を編集</div>
          {ALL_SLOT_KEYS.map((slotKey) => {
            const fields = SLOT_FIELD_KEYS[slotKey];
            const name = dayRowData[fields.name];
            const start = dayRowData[fields.start];
            const end = dayRowData[fields.end];
            const registered = !!(start && end);
            return (
              <button
                key={slotKey}
                type="button"
                onClick={() => setOpenSlotKey(slotKey)}
                className="w-full flex items-center justify-between p-2 rounded-lg border border-gray-100 hover:bg-gray-50 text-left text-sm"
              >
                <span>
                  {registered ? '✅' : '➕'} {fields.label}
                  {registered && name ? `: ${name}` : ''}
                </span>
                {registered && (
                  <span className="text-xs text-gray-500">
                    {start}〜{end}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {viewMode === 'day' && dayQuery.data && (
        <div className="mt-4">
          <MoveDistancePanel
            rowData={dayRowData}
            onChange={(key, value) => setDayRowData((prev) => ({ ...prev, [key]: value }))}
            onSave={() => saveMutation.mutate(dayRowData)}
            saving={saveMutation.isPending}
          />
        </div>
      )}
      {saveMutation.isError && (
        <p className="text-red-500 text-sm text-center mb-2">{saveMutation.error.message}</p>
      )}

      {openSlotKey && (
        <SlotEditModal
          slotKey={openSlotKey}
          rowData={dayRowData}
          onSave={handleSlotSave}
          onClose={() => setOpenSlotKey(null)}
        />
      )}
    </div>
  );
}

function WeekGrid({
  weekAnchor,
  events,
  onDayClick,
}: {
  weekAnchor: Date;
  events: ScheduleEvent[];
  onDayClick: (dateStr: string) => void;
}) {
  const { startHour, endHour } = calComputeHourRange(events);
  const totalHeight = (endHour - startHour) * CAL_WEEK_HOUR_HEIGHT;

  return (
    <div className="flex" style={{ height: totalHeight }}>
      <div className="relative flex-shrink-0" style={{ width: CAL_TIME_AXIS_WIDTH, height: totalHeight }}>
        {Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).map((h) => (
          <div
            key={h}
            className="absolute left-0 text-[8px] text-gray-400"
            style={{ top: (h - startHour) * CAL_WEEK_HOUR_HEIGHT - 5 }}
          >
            {h}
          </div>
        ))}
      </div>
      <div className="flex flex-grow relative gap-0.5">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(weekAnchor);
          d.setDate(d.getDate() + i);
          const dateStr = calYmd(d);
          const dayEvents = events.filter((e) => e.date === dateStr);
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => onDayClick(dateStr)}
              className="flex-1 relative border-l border-gray-100 cursor-pointer text-left"
              style={{ height: totalHeight }}
            >
              {Array.from({ length: endHour - startHour + 1 }, (_, i2) => startHour + i2).map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-gray-100"
                  style={{ top: (h - startHour) * CAL_WEEK_HOUR_HEIGHT }}
                />
              ))}
              {dayEvents.map((e) => {
                const startMin = calTimeToMinutes(e.start) ?? 0;
                const endMin = calTimeToMinutes(e.end) ?? startMin;
                const top = (startMin / 60 - startHour) * CAL_WEEK_HOUR_HEIGHT;
                const height = Math.max(15, ((endMin - startMin) / 60) * CAL_WEEK_HOUR_HEIGHT);
                const cls = CAL_TYPE_STYLE[e.eventType] ?? 'bg-gray-100 border-gray-300';
                return (
                  <div
                    key={e.slotKey}
                    className={`absolute left-0 right-0 z-10 rounded-sm border px-0.5 leading-tight ${cls}`}
                    style={{ top, minHeight: height }}
                    title={`${e.start}〜${e.end} ${e.title}`}
                  >
                    <div className="text-[11px] font-bold" style={{ wordBreak: 'break-word' }}>
                      {e.title || '(名称未設定)'}
                    </div>
                    <div className="text-[9px] opacity-75">
                      {e.start}〜{e.end}
                    </div>
                  </div>
                );
              })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayGrid({
  date,
  events,
  onSlotClick,
}: {
  date: string;
  events: ScheduleEvent[];
  onSlotClick: (slotKey: ScheduleEvent['slotKey']) => void;
}) {
  const dayEvents = events.filter((e) => e.date === date);
  const { startHour, endHour } = calComputeHourRange(dayEvents);
  const totalHeight = (endHour - startHour) * CAL_DAY_HOUR_HEIGHT;

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-gray-100"
          style={{ top: (h - startHour) * CAL_DAY_HOUR_HEIGHT }}
        >
          <span className="text-[10px] text-gray-400 pl-1">{String(h).padStart(2, '0')}:00</span>
        </div>
      ))}
      {dayEvents.map((e) => {
        const startMin = calTimeToMinutes(e.start) ?? 0;
        const endMin = calTimeToMinutes(e.end) ?? startMin;
        const top = (startMin / 60 - startHour) * CAL_DAY_HOUR_HEIGHT;
        const height = Math.max(18, ((endMin - startMin) / 60) * CAL_DAY_HOUR_HEIGHT);
        const cls = CAL_TYPE_STYLE[e.eventType] ?? 'bg-gray-100 text-gray-700 border-gray-300';
        return (
          <button
            key={e.slotKey}
            type="button"
            onClick={() => onSlotClick(e.slotKey)}
            className={`absolute left-12 right-1 rounded-lg border px-2 py-0.5 text-[11px] overflow-hidden text-left ${cls}`}
            style={{ top, height }}
            title={e.title}
          >
            <div className="font-bold truncate">{e.title || '(名称未設定)'}</div>
            <div className="truncate opacity-75">
              {e.start}〜{e.end}
            </div>
          </button>
        );
      })}
    </div>
  );
}
