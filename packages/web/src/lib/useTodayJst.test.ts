import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TODAY_CHECK_INTERVAL_MS, useTodayJst } from './useTodayJst';

// 2026-09-27 23:59(JST) = 14:59Z
const BEFORE_MIDNIGHT = new Date('2026-09-27T14:59:00Z');
const AFTER_MIDNIGHT = new Date('2026-09-27T15:01:00Z');

describe('useTodayJst(開いたまま日付をまたいだら新しい日付にする)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_MIDNIGHT);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('開いた時点の日本時間の日付を返す', () => {
    const { result } = renderHook(() => useTodayJst());
    expect(result.current).toBe('2026-09-27');
  });

  it('画面に戻ってきたとき、日付が変わっていれば新しい日付にする', () => {
    const { result } = renderHook(() => useTodayJst());
    vi.setSystemTime(AFTER_MIDNIGHT);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-09-28');
  });

  it('開いたままでも1分おきに確かめる', () => {
    const { result } = renderHook(() => useTodayJst());
    vi.setSystemTime(AFTER_MIDNIGHT);
    act(() => {
      vi.advanceTimersByTime(TODAY_CHECK_INTERVAL_MS);
    });
    expect(result.current).toBe('2026-09-28');
  });

  it('日付が同じなら同じ日付のまま', () => {
    vi.setSystemTime(new Date('2026-09-27T03:00:00Z')); // 12:00(JST)
    const { result } = renderHook(() => useTodayJst());
    act(() => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(TODAY_CHECK_INTERVAL_MS);
    });
    expect(result.current).toBe('2026-09-27');
  });

  it('外したあとは確かめない(イベント・タイマーを残さない)', () => {
    const { unmount } = renderHook(() => useTodayJst());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
