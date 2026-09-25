import { useCallback, useState } from 'react';
import { readStorage, STORAGE_KEYS, writeStorage } from '../../../lib/storage';
import { addDaysYmd, todayJst, weekStartOf } from '../model/week';

/**
 * 週間予定の表示の状態(GAS版 calWeekAnchorDate / calSelectedDate / calViewMode / calWeekViewMode)。
 * - viewMode: 'week'(7日) / 'day'(1日。記録を直す画面)
 * - weekViewMode: 週の見せかた 'list'(予定のある日だけ。既定) / 'grid'(表)。この端末に覚える。
 */
export type ViewMode = 'week' | 'day';
export type WeekViewMode = 'list' | 'grid';

export function readWeekViewMode(): WeekViewMode {
  return readStorage(STORAGE_KEYS.calWeekViewMode) === 'grid' ? 'grid' : 'list';
}

export function useCalendarNav() {
  const [state, setState] = useState(() => {
    const today = todayJst();
    return { weekStart: weekStartOf(today), selectedDate: today, viewMode: 'week' as ViewMode };
  });
  const [weekViewMode, setWeekViewMode] = useState<WeekViewMode>(readWeekViewMode);

  /** 前の週・次の週(GAS版 moveCalWeek。選んでいる日・表示の種類はそのまま) */
  const moveWeek = useCallback((offsetWeeks: number) => {
    setState((s) => ({ ...s, weekStart: addDaysYmd(s.weekStart, offsetWeeks * 7) }));
  }, []);

  /** 今日へ(GAS版 jumpToTodayWeek) */
  const jumpToToday = useCallback(() => {
    const today = todayJst();
    setState({ weekStart: weekStartOf(today), selectedDate: today, viewMode: 'week' });
  }, []);

  /** その日の1日表示へ(GAS版 drillToDay。週はそのまま) */
  const drillToDay = useCallback((date: string) => {
    setState((s) => ({ ...s, selectedDate: date, viewMode: 'day' }));
  }, []);

  /** その日の1日表示へ。違う週の日なら週も切り替える(GAS版 openScheduleSlotForDate_) */
  const openDate = useCallback((date: string) => {
    setState({ weekStart: weekStartOf(date), selectedDate: date, viewMode: 'day' });
  }, []);

  /** 1日表示で前の日・次の日(GAS版 moveCalDay。週をまたげば週も切り替える) */
  const moveDay = useCallback((offsetDays: number) => {
    setState((s) => {
      const date = addDaysYmd(s.selectedDate, offsetDays);
      return { ...s, selectedDate: date, weekStart: weekStartOf(date) };
    });
  }, []);

  const backToWeek = useCallback(() => setState((s) => ({ ...s, viewMode: 'week' })), []);

  /** 一覧/表の切り替え(GAS版 toggleCalWeekView) */
  const toggleWeekView = useCallback(() => {
    const next: WeekViewMode = weekViewMode === 'list' ? 'grid' : 'list';
    writeStorage(STORAGE_KEYS.calWeekViewMode, next);
    setWeekViewMode(next);
  }, [weekViewMode]);

  return {
    ...state,
    weekViewMode,
    moveWeek,
    jumpToToday,
    drillToDay,
    openDate,
    moveDay,
    backToWeek,
    toggleWeekView,
  };
}

export type CalendarNav = ReturnType<typeof useCalendarNav>;
