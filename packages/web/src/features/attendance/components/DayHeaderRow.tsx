import { type CalendarEvent, dayOfMonth, dayOfWeekLabel, weekDates } from '../model/week';
import { TIME_AXIS_WIDTH } from './gridConstants';

/**
 * 日付ボタンの行(GAS版 renderCalDayHeaderRow)。一覧・表・1日表示のどれでも出し、押すとその日の
 * 1日表示へ(予定の無い日は一覧に出ないため、ここから開く)。予定のある日には点を付ける。
 */
export function DayHeaderRow({
  weekStart,
  today,
  selectedDate,
  events,
  onSelectDay,
}: {
  weekStart: string;
  today: string;
  /** 1日表示で選んでいる日(週表示のときは null) */
  selectedDate: string | null;
  events: readonly CalendarEvent[];
  onSelectDay: (date: string) => void;
}) {
  return (
    <>
      <div className="flex-shrink-0" style={{ width: TIME_AXIS_WIDTH }} />
      <div className="flex flex-grow gap-0.5">
        {weekDates(weekStart).map((date) => {
          const hasEvents = events.some((e) => e.date === date);
          const isSelected = date === selectedDate;
          const baseCls = isSelected
            ? 'bg-blue-600 text-white'
            : date === today
              ? 'bg-blue-50 text-blue-700'
              : 'text-gray-600 active:bg-gray-50';
          const dotCls = hasEvents ? (isSelected ? 'bg-white' : 'bg-blue-500') : 'bg-transparent';
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDay(date)}
              className={`flex-1 min-h-11 flex flex-col items-center justify-center py-2 rounded-xl transition-colors ${baseCls}`}
            >
              <span className="text-sm leading-tight">{dayOfWeekLabel(date)}</span>
              <span className="text-sm font-bold leading-tight">{dayOfMonth(date)}</span>
              <span className={`w-1 h-1 rounded-full ${dotCls} mt-0.5`} />
            </button>
          );
        })}
      </div>
    </>
  );
}
