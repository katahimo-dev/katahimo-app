import type { ScheduleAppointmentWithRouteView, ScheduleWithRouteResponse } from '@katahimo/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleApi } from '../../api/schedule';
import { AdminTargetStaffProvider } from '../../app/adminTargetStaff';
import { createWrapper, deferred, TEST_USER } from '../../test/providers';
import { toastStore } from '../../ui/toast/toastStore';
import { readCachedRoute, writeCachedRoute } from './routeCache';
import { useScheduleView } from './useScheduleView';

vi.mock('../../api/schedule', () => ({
  scheduleApi: { get: vi.fn(), getWithRoute: vi.fn() },
}));

const getWithRoute = vi.mocked(scheduleApi.getWithRoute);
const getPlain = vi.mocked(scheduleApi.get);

function setup() {
  const Base = createWrapper();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Base>
      <AdminTargetStaffProvider>{children}</AdminTargetStaffProvider>
    </Base>
  );
  return renderHook(({ active }: { active: boolean }) => useScheduleView({ active }), {
    wrapper,
    initialProps: { active: true },
  });
}

/** 画面に戻ってきた(ブラウザは document で bubbles つきの visibilitychange を出し、TanStack Query は window で受ける) */
const becomeVisible = () =>
  act(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));

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

function appointment(customerName: string, startTime: string): ScheduleAppointmentWithRouteView {
  return {
    eventType: 'CUSTOMER APPOINTMENT',
    customerName,
    startTime,
    endTime: '12:00',
    reservaUrl: '',
    moveUrl: '',
    moveMin: '',
    moveKm: '',
    attendanceUrl: '',
    attendanceMin: 10,
    attendanceKm: '3.21',
    leavingUrl: '',
    leavingMin: '',
    leavingKm: '',
    customerId: 'C0001',
    address: '',
  };
}

const DATE = '2026-09-27';
const withAppointments = (
  ...appointments: ScheduleAppointmentWithRouteView[]
): ScheduleWithRouteResponse => ({
  success: true,
  appointments,
});
const shownNames = (list: ReturnType<typeof useScheduleView>['list']) =>
  list.kind === 'items' ? list.items.map((i) => i.name) : list.kind;

describe('useScheduleView(前に調べた結果をすぐ出し、裏で最新を取りに行く)', () => {
  // 2026-09-27 20:30(JST)に調べた結果がこのブラウザにある
  const storedAt = new Date('2026-09-27T11:30:00Z').getTime();

  beforeEach(() => {
    localStorage.clear();
    toastStore.hide();
    getWithRoute.mockReset();
    getPlain.mockReset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00Z')); // 2026-09-27 21:00(JST)
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('キャッシュを時点つきですぐ出し、必ず最新を取りに行く。中身が変わったら差し替えて知らせ、キャッシュも上書きする', async () => {
    writeCachedRoute(TEST_USER.staffId, DATE, withAppointments(appointment('山田 花子', '10:00')), storedAt);
    const latest = deferred<ScheduleWithRouteResponse>();
    getWithRoute.mockReturnValue(latest.promise);

    const { result } = setup();
    expect(shownNames(result.current.list)).toEqual(['山田 花子']);
    expect(result.current.routeFetchedAt).toBe(storedAt);
    await waitFor(() => expect(result.current.routeFreshness).toBe('revalidating'));
    expect(result.current.routeBlocking).toBe(false);
    expect(getWithRoute).toHaveBeenCalledWith(
      expect.objectContaining({ date: DATE }),
      false,
      expect.anything(),
    );

    await act(async () => latest.resolve(withAppointments(appointment('鈴木 一郎', '13:00'))));
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    expect(shownNames(result.current.list)).toEqual(['鈴木 一郎']);
    expect(result.current.routeFetchedAt).toBe(Date.now());
    expect(toastStore.getState()).toMatchObject({ message: '最新の予定に更新しました', isError: false });
    expect(readCachedRoute(TEST_USER.staffId, DATE)).toEqual({
      res: withAppointments(appointment('鈴木 一郎', '13:00')),
      ts: Date.now(),
    });
  });

  it('最新の中身が同じなら知らせず、時点の表示だけ新しくする', async () => {
    const same = withAppointments(appointment('山田 花子', '10:00'));
    writeCachedRoute(TEST_USER.staffId, DATE, same, storedAt);
    getWithRoute.mockResolvedValue(same);
    const toastSeq = toastStore.getState().seq;

    const { result } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    expect(result.current.routeFetchedAt).toBe(Date.now());
    expect(toastStore.getState().seq).toBe(toastSeq);
  });

  it('最新を取れなかったら前の表示を残し、時点つきでその旨を知らせる(ルートなしの予定には切り替えない)', async () => {
    writeCachedRoute(TEST_USER.staffId, DATE, withAppointments(appointment('山田 花子', '10:00')), storedAt);
    getWithRoute.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('stale'));
    expect(shownNames(result.current.list)).toEqual(['山田 花子']);
    expect(result.current.routeFetchedAt).toBe(storedAt);
    expect(toastStore.getState()).toMatchObject({ isError: true });
    expect(toastStore.getState().message).toContain('（20:30 時点の予定を表示しています）');
    expect(getPlain).not.toHaveBeenCalled();
  });

  it('キャッシュが無くて取れなかったら、従来どおりルートなしの予定を出す', async () => {
    getWithRoute.mockRejectedValue(new TypeError('Failed to fetch'));
    getPlain.mockResolvedValue({
      success: true,
      appointments: [
        { title: '山田 花子', eventType: 'CUSTOMER APPOINTMENT', start: '10:00', end: '12:00', address: '' },
      ],
    });

    const { result } = setup();
    await waitFor(() => expect(result.current.list.kind).toBe('items'));
    expect(getPlain).toHaveBeenCalledTimes(1);
    expect(result.current.routeFreshness).toBeNull();
    expect(result.current.routeFetchedAt).toBeNull();
  });

  it('画面に戻ってきたとき・予定タブに戻ってきたときに最新を取りに行く', async () => {
    getWithRoute.mockResolvedValue(withAppointments());
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    expect(getWithRoute).toHaveBeenCalledTimes(1);

    becomeVisible();
    await waitFor(() => expect(getWithRoute).toHaveBeenCalledTimes(2));

    // 下タブで隠れている間は画面に戻っても読まない
    rerender({ active: false });
    await waitFor(() => expect(result.current.routeLoading).toBe(false));
    becomeVisible();
    expect(getWithRoute).toHaveBeenCalledTimes(2);
    rerender({ active: true });
    await waitFor(() => expect(getWithRoute).toHaveBeenCalledTimes(3));
  });
});
