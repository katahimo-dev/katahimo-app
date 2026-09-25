import { type CalendarEvent, eventBox, hoursBetween } from '../model/week';
import { DAY_HOUR_HEIGHT, EVENT_TYPE_STYLE } from './gridConstants';

/** 1日表示の時間軸。予定を押すとその予定の修正へ(GAS版 renderCalDayGrid)。 */
export function DayGrid({
  events,
  startHour,
  endHour,
  onSelectEvent,
}: {
  events: readonly CalendarEvent[];
  startHour: number;
  endHour: number;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  const totalHeight = (endHour - startHour) * DAY_HOUR_HEIGHT;
  return (
    <div className="relative" style={{ height: totalHeight }}>
      {hoursBetween(startHour, endHour).map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-gray-100"
          style={{ top: (h - startHour) * DAY_HOUR_HEIGHT }}
        >
          <span className="text-sm text-gray-600 pl-1">{String(h).padStart(2, '0')}:00</span>
        </div>
      ))}
      {events.map((e) => {
        const { top, height } = eventBox(e, startHour, DAY_HOUR_HEIGHT, 18);
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: GAS版と同じく予定の帯を押して開く
          <div
            key={e.slotKey}
            onClick={() => onSelectEvent(e)}
            className={`absolute left-12 right-1 rounded-lg border px-2 py-0.5 text-sm overflow-hidden cursor-pointer ${EVENT_TYPE_STYLE[e.eventType] ?? 'bg-gray-100 text-gray-700 border-gray-300'}`}
            style={{ top, height }}
            title={e.title}
          >
            <div className="font-bold truncate">{e.title || '（名前なし）'}</div>
            <div className="truncate opacity-75">
              {e.start}〜{e.end}
            </div>
          </div>
        );
      })}
    </div>
  );
}
