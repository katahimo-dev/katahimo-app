import type { ScheduleOffset } from './scheduleDate';

const DAYS: Array<{ offset: ScheduleOffset; id: string; label: string }> = [
  { offset: 0, id: 'scheduleTodayBtn', label: '☀️ 今日' },
  { offset: 1, id: 'scheduleTomorrowBtn', label: '🌙 明日' },
];

/** ☀️ 今日 / 🌙 明日(GAS版 #scheduleTodayBtn / #scheduleTomorrowBtn。選んでいる方を青くする) */
export function ScheduleDayToggle({
  offset,
  onSelect,
}: {
  offset: ScheduleOffset;
  onSelect: (offset: ScheduleOffset) => void;
}) {
  return (
    <div className="flex gap-3 mb-4">
      {DAYS.map((day) => (
        <button
          key={day.id}
          type="button"
          id={day.id}
          onClick={() => onSelect(day.offset)}
          aria-pressed={offset === day.offset}
          className={`flex-1 min-h-12 py-3 rounded-xl text-base font-bold border transition-colors${
            offset === day.offset ? ' bg-blue-600 text-white' : ''
          }`}
        >
          {day.label}
        </button>
      ))}
    </div>
  );
}
