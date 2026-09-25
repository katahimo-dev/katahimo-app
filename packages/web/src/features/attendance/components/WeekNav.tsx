import { weekRangeLabel } from '../model/week';

/** 「◀ 前の週」/「M月D日〜M月D日」「今日へ」「HH:MM 時点」/「次の週 ▶」 */
export function WeekNav({
  weekStart,
  updatedAtLabel,
  onMoveWeek,
  onToday,
}: {
  weekStart: string;
  updatedAtLabel: string;
  onMoveWeek: (offset: number) => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <button
        type="button"
        onClick={() => onMoveWeek(-1)}
        className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold whitespace-nowrap"
      >
        ◀ 前の週
      </button>
      <div className="flex flex-col items-center">
        <span id="calWeekLabel" className="text-base font-bold text-gray-800">
          {weekRangeLabel(weekStart)}
        </span>
        <button
          type="button"
          onClick={onToday}
          className="min-h-11 px-3 py-2 mt-1 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold"
        >
          今日へ
        </button>
        <span id="calWeekUpdatedAt" className="text-sm text-gray-600 mt-0.5">
          {updatedAtLabel}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onMoveWeek(1)}
        className="min-h-11 px-3 py-2 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold whitespace-nowrap"
      >
        次の週 ▶
      </button>
    </div>
  );
}
