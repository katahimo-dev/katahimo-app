import { EmptyState } from '../../../ui/StatusViews';
import { formatMinutesJa } from '../model/format';
import { type CalendarEvent, dayOfMonth, dayOfWeekLabel, summarizeDayEvents, weekDates } from '../model/week';

/**
 * 週の一覧(既定の見せかた): 予定のある日だけを1日1行で出す。押すとその日の1日表示へ
 * (GAS版 renderCalWeekList)。
 */
export function WeekList({
  weekStart,
  today,
  events,
  onSelectDay,
}: {
  weekStart: string;
  today: string;
  events: readonly CalendarEvent[];
  onSelectDay: (date: string) => void;
}) {
  const rows = weekDates(weekStart)
    .map((date) => ({ date, dayEvents: events.filter((e) => e.date === date) }))
    .filter((r) => r.dayEvents.length > 0);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="📭"
        title="この週は予定がありません"
        hint="ほかの週は「◀ 前の週」「次の週 ▶」で見られます。この週に記録を足すときは「📋 表で見る」を押して日にちを選んでください。"
      />
    );
  }

  return (
    <>
      {rows.map(({ date, dayEvents }) => {
        const summary = summarizeDayEvents(dayEvents);
        const borderCls = date === today ? 'border-2 border-blue-600' : 'border border-gray-200';
        // 時刻が読めない日は合計も「—」(0分と出して誤解されないように)
        const total = summary.timeRange === '' ? '—' : formatMinutesJa(summary.totalMinutes);
        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelectDay(date)}
            className={`w-full text-left min-h-12 flex items-center gap-3 p-3 rounded-xl bg-white active:bg-blue-50 ${borderCls}`}
          >
            <div className="flex-shrink-0 w-10 text-center">
              <div className="text-xl font-bold text-gray-800 leading-tight">{dayOfMonth(date)}</div>
              <div className="text-sm text-gray-600 leading-tight">{dayOfWeekLabel(date)}</div>
            </div>
            <div className="flex-grow min-w-0">
              <div className="font-bold text-base text-gray-800 truncate">{summary.titles}</div>
              <div className="text-sm text-gray-600">{summary.timeRange}</div>
            </div>
            <div className="flex-shrink-0 text-right">
              <div className="text-sm text-gray-600">予定の合計</div>
              <div className="text-base font-bold text-blue-700 whitespace-nowrap">{total}</div>
            </div>
          </button>
        );
      })}
    </>
  );
}
