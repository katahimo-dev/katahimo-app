import { type CalendarEvent, eventBox, hoursBetween, weekDates } from '../model/week';
import { EVENT_TYPE_STYLE, TIME_AXIS_WIDTH, WEEK_HOUR_HEIGHT } from './gridConstants';

/**
 * 表(7列の週間グリッド)。列を押すとその日の1日表示へ、予定を押すとその予定の修正へ
 * (GAS版 renderCalWeekGrid)。
 */
export function WeekGrid({
  weekStart,
  events,
  startHour,
  endHour,
  onSelectDay,
  onSelectEvent,
}: {
  weekStart: string;
  events: readonly CalendarEvent[];
  startHour: number;
  endHour: number;
  onSelectDay: (date: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const totalHeight = (endHour - startHour) * WEEK_HOUR_HEIGHT;
  const hours = hoursBetween(startHour, endHour);
  return (
    <div className="flex">
      <div className="relative flex-shrink-0" style={{ width: TIME_AXIS_WIDTH, height: totalHeight }}>
        {hours.map((h) => (
          <div
            key={h}
            className="absolute left-0 text-sm text-gray-600"
            style={{ top: (h - startHour) * WEEK_HOUR_HEIGHT - 5 }}
          >
            {h}
          </div>
        ))}
      </div>
      <div className="flex flex-grow relative gap-0.5">
        {weekDates(weekStart).map((date) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: GAS版と同じく列全体を押せる(日付ボタンの行でも同じ操作ができる)
          <div
            key={date}
            onClick={() => onSelectDay(date)}
            className="flex-1 relative border-l border-gray-100 cursor-pointer"
            style={{ height: totalHeight }}
          >
            {hours.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-gray-100"
                style={{ top: (h - startHour) * WEEK_HOUR_HEIGHT }}
              />
            ))}
            {events
              .filter((e) => e.date === date)
              .map((e) => {
                const { top, height } = eventBox(e, startHour, WEEK_HOUR_HEIGHT, 15);
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: GAS版と同じく色帯を押して開く
                  <div
                    key={e.slotKey}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onSelectEvent(e);
                    }}
                    className={`absolute left-0 right-0 z-10 rounded-sm border px-0.5 leading-tight cursor-pointer ${EVENT_TYPE_STYLE[e.eventType] ?? 'bg-gray-100 border-gray-300'}`}
                    style={{ top, minHeight: height }}
                    title={`${e.start}〜${e.end} ${e.title}`}
                  >
                    <div className="text-sm font-bold" style={{ wordBreak: 'break-word' }}>
                      {e.title || '（名前なし）'}
                    </div>
                    <div className="text-sm opacity-75">
                      {e.start}〜{e.end}
                    </div>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
