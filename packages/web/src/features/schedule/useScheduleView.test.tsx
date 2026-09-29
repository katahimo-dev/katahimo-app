import type { ScheduleAppointmentWithRouteView, ScheduleWithRouteResponse } from '@katahimo/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleApi } from '../../api/schedule';
import { AdminTargetStaffProvider, useAdminTargetStaff } from '../../app/adminTargetStaff';
import { createWrapper, deferred, TEST_USER } from '../../test/providers';
import { toastStore } from '../../ui/toast/toastStore';
import { readCachedRoute, writeCachedRoute } from './routeCache';
import { formatRouteFetchedAt } from './scheduleDate';
import { SCHEDULE_REFOCUS_INTERVAL_MS, useScheduleView } from './useScheduleView';

vi.mock('../../api/schedule', () => ({
  scheduleApi: { get: vi.fn(), getWithRoute: vi.fn() },
}));

const getWithRoute = vi.mocked(scheduleApi.getWithRoute);
const getPlain = vi.mocked(scheduleApi.get);

function wrapperFor() {
  const Base = createWrapper();
  return ({ children }: { children: ReactNode }) => (
    <Base>
      <AdminTargetStaffProvider>{children}</AdminTargetStaffProvider>
    </Base>
  );
}

function setup(initialProps = { active: true }) {
  return renderHook(({ active }: { active: boolean }) => useScheduleView({ active }), {
    wrapper: wrapperFor(),
    initialProps,
  });
}

/** 表示するスタッフも切り替えるテスト用 */
function setupWithTarget() {
  return renderHook(() => ({ view: useScheduleView(), target: useAdminTargetStaff() }), {
    wrapper: wrapperFor(),
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
    expect(toastStore.getState().message).toBe(
      'うまくいきませんでした。電波を確認して、もう一度押してください。9月27日（日） 20:30 時点の表示のままです',
    );
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

  it('画面に戻ってきた・予定タブに戻ってきたときは、前に調べてから10分以上たっていれば読み直す', async () => {
    getWithRoute.mockResolvedValue(withAppointments());
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    expect(getWithRoute).toHaveBeenCalledTimes(1);

    // 10分以内は画面に戻っても読まない(すぐ確かめたいときは 🔄)
    vi.setSystemTime(Date.now() + SCHEDULE_REFOCUS_INTERVAL_MS - 1_000);
    becomeVisible();
    expect(getWithRoute).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1_000);
    becomeVisible();
    await waitFor(() => expect(getWithRoute).toHaveBeenCalledTimes(2));

    // 下タブで隠れている間は画面に戻っても読まない
    rerender({ active: false });
    await waitFor(() => expect(result.current.routeLoading).toBe(false));
    vi.setSystemTime(Date.now() + 60_000);
    becomeVisible();
    expect(getWithRoute).toHaveBeenCalledTimes(2);
    // 予定タブに戻っても、10分以内なら読まない
    rerender({ active: true });
    expect(getWithRoute).toHaveBeenCalledTimes(2);
    // 10分たってから予定タブに戻ったら読む
    rerender({ active: false });
    vi.setSystemTime(Date.now() + SCHEDULE_REFOCUS_INTERVAL_MS);
    rerender({ active: true });
    await waitFor(() => expect(getWithRoute).toHaveBeenCalledTimes(3));
  });

  it('予定タブを開いたままなら10分ごとに読み直す(予定タブが隠れている間は読まない)', async () => {
    getWithRoute.mockResolvedValue(withAppointments());
    const { result, rerender } = setup({ active: false });
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    expect(getWithRoute).toHaveBeenCalledTimes(1);
    // ここからの繰り返しの時計を進められるようにしてから、予定タブを前に出す(10分以内なので、戻っただけでは読まない)
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    rerender({ active: true });
    const advance = (ms: number) =>
      act(async () => {
        vi.advanceTimersByTime(ms);
      });
    await advance(SCHEDULE_REFOCUS_INTERVAL_MS - 1_000);
    expect(getWithRoute).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(getWithRoute).toHaveBeenCalledTimes(2);

    rerender({ active: false });
    await advance(SCHEDULE_REFOCUS_INTERVAL_MS * 2);
    expect(getWithRoute).toHaveBeenCalledTimes(2);
  });

  it('所要時間・距離だけが変わったときは「更新しました」を出さない(予定の中身だけで比べる)', async () => {
    writeCachedRoute(TEST_USER.staffId, DATE, withAppointments(appointment('山田 花子', '10:00')), storedAt);
    getWithRoute.mockResolvedValue(
      withAppointments({ ...appointment('山田 花子', '10:00'), attendanceMin: 25, attendanceKm: '9.99' }),
    );
    const toastSeq = toastStore.getState().seq;
    const { result } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    expect(toastStore.getState().seq).toBe(toastSeq);
    expect(readCachedRoute(TEST_USER.staffId, DATE)?.res.appointments?.[0]?.attendanceMin).toBe(25);
  });

  it('読めないカレンダーがあった結果(partial)は前の表示を置き換えず、端末の値も上書きせず、その旨を知らせる', async () => {
    const previous = withAppointments(appointment('山田 花子', '10:00'));
    writeCachedRoute(TEST_USER.staffId, DATE, previous, storedAt);
    getWithRoute.mockResolvedValue({ ...withAppointments(), partial: true });

    const { result } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('stale'));
    expect(shownNames(result.current.list)).toEqual(['山田 花子']);
    expect(result.current.routeFetchedAt).toBe(storedAt);
    expect(readCachedRoute(TEST_USER.staffId, DATE)).toEqual({ res: previous, ts: storedAt });
    expect(toastStore.getState()).toMatchObject({
      message: '一部のカレンダーを読み込めませんでした。9月27日（日） 20:30 時点の表示のままです',
      isError: true,
    });
  });

  it('前の表示が無ければ partial の結果を出すが、欠けているかもしれない旨を添え、端末には書かない', async () => {
    getWithRoute.mockResolvedValue({ ...withAppointments(appointment('山田 花子', '10:00')), partial: true });
    const { result } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('partial'));
    expect(shownNames(result.current.list)).toEqual(['山田 花子']);
    expect(readCachedRoute(TEST_USER.staffId, DATE)).toBeNull();
    expect(toastStore.getState().message).toBe(
      '一部のカレンダーを読み込めなかったため、予定が欠けているかもしれません',
    );
  });

  it('前の表示も partial なら、新しい partial の結果で置き換える(端末には書かない)', async () => {
    const first = { ...withAppointments(appointment('山田 花子', '10:00')), partial: true };
    getWithRoute.mockResolvedValueOnce(first);
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('partial'));
    const firstAt = result.current.routeFetchedAt;

    vi.setSystemTime(Date.now() + SCHEDULE_REFOCUS_INTERVAL_MS);
    const toastSeq = toastStore.getState().seq;
    getWithRoute.mockResolvedValueOnce({
      ...withAppointments(appointment('鈴木 一郎', '13:00')),
      partial: true,
    });
    rerender({ active: false });
    rerender({ active: true });
    await waitFor(() => expect(shownNames(result.current.list)).toEqual(['鈴木 一郎']));
    expect(result.current.routeFreshness).toBe('partial');
    expect(result.current.routeFetchedAt).toBeGreaterThan(firstAt ?? 0);
    expect(readCachedRoute(TEST_USER.staffId, DATE)).toBeNull();
    expect(toastStore.getState().seq).toBe(toastSeq + 1);
    expect(toastStore.getState().message).toBe(
      '一部のカレンダーを読み込めなかったため、予定が欠けているかもしれません',
    );
  });

  it('ルートなしの予定が partial なら、欠けているかもしれない旨を出す(予定タブが前に出ているときだけ)', async () => {
    getWithRoute.mockRejectedValue(new TypeError('Failed to fetch'));
    getPlain.mockResolvedValue({
      success: true,
      partial: true,
      appointments: [
        { title: '山田 花子', eventType: 'CUSTOMER APPOINTMENT', start: '10:00', end: '12:00', address: '' },
      ],
    });
    const { result } = setup();
    await waitFor(() => expect(shownNames(result.current.list)).toEqual(['山田 花子']));
    await waitFor(() =>
      expect(toastStore.getState().message).toBe(
        '一部のカレンダーを読み込めなかったため、予定が欠けているかもしれません',
      ),
    );

    const hidden = setup({ active: false });
    const toastSeq = toastStore.getState().seq;
    await waitFor(() => expect(shownNames(hidden.result.current.list)).toEqual(['山田 花子']));
    expect(toastStore.getState().seq).toBe(toastSeq);
  });

  it('ルートなしの予定を出している間にルートつきを読み直しても、一覧を消さない', async () => {
    getWithRoute.mockRejectedValue(new TypeError('Failed to fetch'));
    getPlain.mockResolvedValue({
      success: true,
      appointments: [
        { title: '山田 花子', eventType: 'CUSTOMER APPOINTMENT', start: '10:00', end: '12:00', address: '' },
      ],
    });
    const { result, rerender } = setup();
    await waitFor(() => expect(shownNames(result.current.list)).toEqual(['山田 花子']));

    const pending = deferred<ScheduleWithRouteResponse>();
    getWithRoute.mockReturnValue(pending.promise);
    vi.setSystemTime(Date.now() + SCHEDULE_REFOCUS_INTERVAL_MS);
    rerender({ active: false });
    rerender({ active: true });
    await waitFor(() => expect(result.current.routeLoading).toBe(true));
    expect(shownNames(result.current.list)).toEqual(['山田 花子']);
    await act(async () => pending.resolve(withAppointments(appointment('鈴木 一郎', '13:00'))));
    await waitFor(() => expect(shownNames(result.current.list)).toEqual(['鈴木 一郎']));
    expect(getPlain).toHaveBeenCalledTimes(1);
  });

  it('予定タブが隠れている間の読み込みの失敗は知らせない', async () => {
    getWithRoute.mockRejectedValue(new TypeError('Failed to fetch'));
    getPlain.mockResolvedValue({ success: true, appointments: [] });
    const toastSeq = toastStore.getState().seq;
    const { result } = setup({ active: false });
    await waitFor(() => expect(result.current.list.kind).toBe('items'));
    expect(toastStore.getState().seq).toBe(toastSeq);
  });

  it('日付・スタッフを切り替えたあとに届いた前の応答では知らせない', async () => {
    writeCachedRoute(TEST_USER.staffId, DATE, withAppointments(appointment('山田 花子', '10:00')), storedAt);
    const first = deferred<ScheduleWithRouteResponse>();
    getWithRoute.mockReturnValueOnce(first.promise);
    getWithRoute.mockResolvedValue(withAppointments());
    const toastSeq = toastStore.getState().seq;

    const { result } = setupWithTarget();
    await waitFor(() => expect(result.current.view.routeFreshness).toBe('revalidating'));
    act(() => result.current.view.selectDay(1));
    await waitFor(() => expect(result.current.view.date.dateStr).toBe('2026-09-28'));
    await act(async () => first.reject(new TypeError('Failed to fetch')));

    const second = deferred<ScheduleWithRouteResponse>();
    getWithRoute.mockReturnValueOnce(second.promise);
    act(() => result.current.view.selectDay(0));
    await waitFor(() => expect(result.current.view.routeFreshness).toBe('revalidating'));
    act(() => result.current.target.setTargetStaffId('00000000-0000-4000-8000-00000000b002'));
    await act(async () => second.resolve(withAppointments(appointment('鈴木 一郎', '13:00'))));
    await waitFor(() => expect(result.current.view.routeLoading).toBe(false));

    expect(toastStore.getState().seq).toBe(toastSeq);
    // 前の応答で端末の値も上書きしない
    expect(readCachedRoute(TEST_USER.staffId, DATE)?.res.appointments?.[0]?.customerName).toBe('山田 花子');
  });

  it('🔄 の応答が画面を離れた(ログアウトを含む)あとに届いても、端末に書き戻さない', async () => {
    getWithRoute.mockResolvedValue(withAppointments());
    const { result, unmount } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    localStorage.clear();

    const pending = deferred<ScheduleWithRouteResponse>();
    getWithRoute.mockImplementationOnce((_req, force, signal) => {
      expect(force).toBe(true);
      expect(signal?.aborted).toBe(false);
      return pending.promise;
    });
    act(() => result.current.refreshRoute());
    await waitFor(() => expect(result.current.routeBlocking).toBe(true));
    const signal = getWithRoute.mock.calls.at(-1)?.[2];
    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve(withAppointments(appointment('鈴木 一郎', '13:00'))));
    expect(readCachedRoute(TEST_USER.staffId, DATE)).toBeNull();
  });

  it('🔄 の失敗は自動の読み込みと同じ文言で、前の表示を残す', async () => {
    getWithRoute.mockResolvedValueOnce(withAppointments(appointment('山田 花子', '10:00')));
    const { result } = setup();
    await waitFor(() => expect(result.current.routeFreshness).toBe('fresh'));
    const fetchedAt = result.current.routeFetchedAt ?? 0;
    getWithRoute.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    act(() => result.current.refreshRoute());
    await waitFor(() => expect(result.current.routeBlocking).toBe(false));
    expect(shownNames(result.current.list)).toEqual(['山田 花子']);
    expect(toastStore.getState().message).toBe(
      `うまくいきませんでした。電波を確認して、もう一度押してください。${formatRouteFetchedAt(fetchedAt)}の表示のままです`,
    );
  });
});
