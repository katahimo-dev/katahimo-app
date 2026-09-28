import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDaysYmd } from '../../lib/date';
import { followDefaultRange, useFollowDefaultRange } from './useFollowDefaultRange';

const rangeFor = (today: string) => ({ from: addDaysYmd(today, -6), to: today });

describe('followDefaultRange(開いたまま日付をまたいだときの既定の期間)', () => {
  const prev = rangeFor('2026-09-27');
  const next = rangeFor('2026-09-28');
  it('既定の期間のままなら今日の既定にする(期間以外の絞り込みは残す)', () => {
    expect(followDefaultRange({ ...prev, staffId: 's1' }, prev, next)).toEqual({ ...next, staffId: 's1' });
  });
  it('期間を自分で変えていたらそのまま', () => {
    const custom = { from: '2026-09-01', to: '2026-09-27' };
    expect(followDefaultRange(custom, prev, next)).toBe(custom);
    const cleared = { from: prev.from };
    expect(followDefaultRange(cleared, prev, next)).toBe(cleared);
  });
});

describe('useFollowDefaultRange', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z')); // 2026-09-27 21:00(JST)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(initialApplied?: { from?: string; to?: string }) {
    return renderHook(() => {
      const [form, setForm] = useState<{ from?: string; to?: string }>(rangeFor('2026-09-27'));
      const [applied, setApplied] = useState(initialApplied ?? rangeFor('2026-09-27'));
      useFollowDefaultRange(rangeFor, setForm, setApplied);
      return { form, applied, setForm };
    });
  }
  const resumeNextDay = () =>
    act(() => {
      vi.setSystemTime(new Date('2026-09-28T00:00:00Z'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

  it('画面に戻ったとき、入力中・一覧の両方の期間を今日までにする', () => {
    const { result } = setup();
    resumeNextDay();
    expect(result.current.form).toEqual(rangeFor('2026-09-28'));
    expect(result.current.applied).toEqual(rangeFor('2026-09-28'));
  });

  it('自分で変えた期間は動かさない(一覧だけ変えて探していた場合も)', () => {
    const custom = { from: '2026-09-01', to: '2026-09-10' };
    const { result } = setup(custom);
    act(() => result.current.setForm(custom));
    resumeNextDay();
    expect(result.current.form).toEqual(custom);
    expect(result.current.applied).toEqual(custom);
  });
});
