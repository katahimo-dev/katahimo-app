import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followTodayIfUnmoved, useCalendarNav } from './useCalendarNav';

describe('followTodayIfUnmoved(開いたまま日付をまたいだときの週間予定の場所)', () => {
  // 2026-09-27 は日曜(週の始まり)
  const onToday = { weekStart: '2026-09-27', selectedDate: '2026-09-27', viewMode: 'week' as const };

  it('前の今日のまま週で見ていたら、今日の週・今日にする', () => {
    expect(followTodayIfUnmoved(onToday, '2026-09-27', '2026-09-28')).toEqual({
      weekStart: '2026-09-27',
      selectedDate: '2026-09-28',
      viewMode: 'week',
    });
  });
  it('週をまたいだら次の週にする(土曜 → 日曜)', () => {
    const sat = { weekStart: '2026-09-27', selectedDate: '2026-10-03', viewMode: 'week' as const };
    expect(followTodayIfUnmoved(sat, '2026-10-03', '2026-10-04')).toEqual({
      weekStart: '2026-10-04',
      selectedDate: '2026-10-04',
      viewMode: 'week',
    });
  });
  it('日付が同じなら何もしない', () => {
    expect(followTodayIfUnmoved(onToday, '2026-09-27', '2026-09-27')).toBe(onToday);
  });
  it('1日表示(記録を直す画面)のときはそのまま', () => {
    const day = { ...onToday, viewMode: 'day' as const };
    expect(followTodayIfUnmoved(day, '2026-09-27', '2026-09-28')).toBe(day);
  });
  it('自分で別の日・別の週を開いていたらそのまま', () => {
    const otherDay = { ...onToday, selectedDate: '2026-09-25' };
    expect(followTodayIfUnmoved(otherDay, '2026-09-27', '2026-09-28')).toBe(otherDay);
    const otherWeek = { ...onToday, weekStart: '2026-09-20' };
    expect(followTodayIfUnmoved(otherWeek, '2026-09-27', '2026-09-28')).toBe(otherWeek);
  });
});

describe('useCalendarNav(開いたまま日付をまたいだとき)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z')); // 2026-09-27 21:00(JST)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const resumeAt = (iso: string) =>
    act(() => {
      vi.setSystemTime(new Date(iso));
      document.dispatchEvent(new Event('visibilitychange'));
    });

  it('今日のまま見ていたら、画面に戻ったとき今日に合わせる', () => {
    const { result } = renderHook(() => useCalendarNav());
    resumeAt('2026-09-28T00:00:00Z'); // 2026-09-28 09:00(JST)
    expect(result.current.selectedDate).toBe('2026-09-28');
    expect(result.current.weekStart).toBe('2026-09-27');
  });

  it('1日表示の間は動かさず、週に戻ったら今日に合わせる', () => {
    const { result } = renderHook(() => useCalendarNav());
    act(() => result.current.drillToDay('2026-09-27'));
    resumeAt('2026-09-28T00:00:00Z');
    expect(result.current.selectedDate).toBe('2026-09-27');
    expect(result.current.viewMode).toBe('day');
    act(() => result.current.backToWeek());
    expect(result.current.selectedDate).toBe('2026-09-28');
  });

  it('自分で前の週を開いていたら動かさない', () => {
    const { result } = renderHook(() => useCalendarNav());
    act(() => result.current.moveWeek(-1));
    resumeAt('2026-09-28T00:00:00Z');
    expect(result.current.weekStart).toBe('2026-09-20');
    expect(result.current.selectedDate).toBe('2026-09-27');
    // 前の週から戻ってきても、もう合わせない(その日のうちに自分で動かしたため)
    act(() => result.current.moveWeek(1));
    resumeAt('2026-09-28T01:00:00Z');
    expect(result.current.selectedDate).toBe('2026-09-27');
  });
});
