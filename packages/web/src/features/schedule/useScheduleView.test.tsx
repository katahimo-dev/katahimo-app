import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleApi } from '../../api/schedule';
import { AdminTargetStaffProvider } from '../../app/adminTargetStaff';
import { createWrapper } from '../../test/providers';
import { toastStore } from '../../ui/toast/toastStore';
import { useScheduleView } from './useScheduleView';

vi.mock('../../api/schedule', () => ({
  scheduleApi: { get: vi.fn(), getWithRoute: vi.fn() },
}));

const getWithRoute = vi.mocked(scheduleApi.getWithRoute);

function setup() {
  const Base = createWrapper();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Base>
      <AdminTargetStaffProvider>{children}</AdminTargetStaffProvider>
    </Base>
  );
  return renderHook(() => useScheduleView(), { wrapper });
}

const resumeAt = (iso: string) =>
  act(() => {
    vi.setSystemTime(new Date(iso));
    document.dispatchEvent(new Event('visibilitychange'));
  });

const requestedDates = () => getWithRoute.mock.calls.map(([req, force]) => [req.date, force]);

describe('useScheduleView(開いたまま日付をまたいだとき)', () => {
  beforeEach(() => {
    localStorage.clear();
    getWithRoute.mockReset();
    getWithRoute.mockResolvedValue({ success: true, appointments: [] });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z')); // 2026-09-27 21:00(JST)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('画面に戻ったとき、選んでいる「明日」を今の明日で読み直す', async () => {
    const { result } = setup();
    act(() => result.current.selectDay(1));
    await waitFor(() => expect(requestedDates()).toContainEqual(['2026-09-28', false]));
    expect(result.current.date.label).toBe('9月28日（月）明日');

    resumeAt('2026-09-28T00:00:00Z'); // 2026-09-28 09:00(JST)
    expect(result.current.date.dateStr).toBe('2026-09-29');
    expect(result.current.date.label).toBe('9月29日（火）明日');
    await waitFor(() => expect(requestedDates()).toContainEqual(['2026-09-29', false]));
    expect(toastStore.getState().message).toBe('日付が変わったので、予定を読み込み直しました');
  });

  it('🔄 を押したとき日付をまたいでいたら、前の日を調べ直さず今の日付で読む', async () => {
    const { result } = setup();
    await waitFor(() => expect(requestedDates()).toContainEqual(['2026-09-27', false]));
    // 画面に戻る知らせが来ないまま日付だけ進んだ(1分おきの確認より前に押した)
    vi.setSystemTime(new Date('2026-09-28T00:00:00Z'));
    act(() => result.current.refreshRoute());
    expect(result.current.date.dateStr).toBe('2026-09-28');
    await waitFor(() => expect(requestedDates()).toContainEqual(['2026-09-28', false]));
    expect(requestedDates()).not.toContainEqual(['2026-09-27', true]);
  });

  it('日付が同じなら 🔄 はキャッシュを使わず調べ直す(従来どおり)', async () => {
    const { result } = setup();
    await waitFor(() => expect(requestedDates()).toContainEqual(['2026-09-27', false]));
    act(() => result.current.refreshRoute());
    await waitFor(() => expect(requestedDates()).toContainEqual(['2026-09-27', true]));
  });
});
