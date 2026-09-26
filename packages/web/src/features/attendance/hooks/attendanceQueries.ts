import {
  type AttendanceDay,
  type AttendanceMonth,
  attendanceMonthSchema,
  attendanceWeekResponseSchema,
} from '@katahimo/shared';
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { attendanceApi } from '../../../api/attendance';
import { useAdminTargetStaff } from '../../../app/adminTargetStaff';
import { removeStorage } from '../../../lib/storage';
import {
  type Cached,
  clearAttendanceCaches,
  clearMonthlyCaches,
  monthCacheKey,
  readCache,
  weekCacheKey,
  writeCache,
} from '../model/cache';
import { addDaysYmd, type CalendarEvent } from '../model/week';

/**
 * 出勤簿タブのデータ読み込み。TanStack Query のキャッシュに加えて、GAS版と同じ localStorage の
 * 2時間キャッシュ(週間予定・今月のまとめ)を使う(同じ週を行き来したとき・開き直したときに
 * 読み直さない)。出勤簿が変わりうる操作の後は `useAttendanceInvalidation` で両方を捨てて読み直す。
 */
export const attendanceKeys = {
  all: ['attendance'] as const,
  week: (staffId: string, weekStart: string) => ['attendance', 'week', staffId, weekStart] as const,
  day: (staffId: string, date: string) => ['attendance', 'day', staffId, date] as const,
  month: (staffId: string, yearMonth: string) => ['attendance', 'month', staffId, yearMonth] as const,
};

/** 誰の出勤簿を見ているか(キャッシュのキー用の本人/選択中のスタッフID と、APIに渡す staffId)。 */
export function useAttendanceTarget() {
  const { targetStaffId, requestStaffId } = useAdminTargetStaff();
  return { staffKey: targetStaffId, staffId: requestStaffId };
}

export interface WeekData {
  events: CalendarEvent[];
  fetchedAt: number;
}

/** 週間予定(GAS版 loadWeekEvents)。 */
export function useWeekEvents(weekStart: string) {
  const { staffKey, staffId } = useAttendanceTarget();
  return useQuery({
    queryKey: attendanceKeys.week(staffKey, weekStart),
    queryFn: async ({ signal }): Promise<WeekData> => {
      const cacheKey = weekCacheKey(staffKey, weekStart);
      const cached = readCache<unknown>(cacheKey, 'events');
      const parsedCache = cached && attendanceWeekResponseSchema.shape.events.safeParse(cached.value);
      if (cached && parsedCache?.success) return { events: parsedCache.data, fetchedAt: cached.ts };
      const res = await attendanceApi.getWeek(
        { start: weekStart, end: addDaysYmd(weekStart, 6), staffId },
        signal,
      );
      const fetchedAt = Date.now();
      writeCache(cacheKey, 'events', res.events, fetchedAt);
      return { events: res.events, fetchedAt };
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** 1日分の出勤簿(GAS版 fetchPastScheduleForDate_)。日を開くたびに読み直す。 */
export function useAttendanceDay(date: string) {
  const { staffKey, staffId } = useAttendanceTarget();
  return useQuery({
    queryKey: attendanceKeys.day(staffKey, date),
    queryFn: ({ signal }) => attendanceApi.getDay({ date, staffId }, signal).then((r) => r.attendance),
    staleTime: 0,
    // 読み直すたびに「読み込んでいます…」を出すので、画面に戻っただけでは読み直さない
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** 今月のまとめ(GAS版 loadAttendanceMonthly)。yearMonth が null の間は読まない。 */
export function useAttendanceMonth(yearMonth: string | null) {
  const { staffKey, staffId } = useAttendanceTarget();
  return useQuery({
    queryKey: attendanceKeys.month(staffKey, yearMonth ?? ''),
    enabled: yearMonth !== null,
    queryFn: async ({ signal }): Promise<Cached<AttendanceMonth>> => {
      const ym = yearMonth as string;
      const cacheKey = monthCacheKey(staffKey, ym);
      const cached = readCache<unknown>(cacheKey, 'res');
      const parsedCache = cached && attendanceMonthSchema.safeParse(cached.value);
      if (cached && parsedCache?.success) return { value: parsedCache.data, ts: cached.ts };
      const res = await attendanceApi.getMonth({ month: ym, staffId }, signal);
      const ts = Date.now();
      writeCache(cacheKey, 'res', res.month, ts);
      return { value: res.month, ts };
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** 1日分をいま読み直して結果を返す(読めなければ null)。 */
async function refetchDay(queryClient: QueryClient, key: readonly unknown[]) {
  await queryClient.refetchQueries({ queryKey: key, exact: true });
  const state = queryClient.getQueryState<AttendanceDay>(key);
  return state?.status === 'success' ? (state.data ?? null) : null;
}

/** 週間予定・今月のまとめは中身を捨てて(読み込み中を出して)読み直す */
function resetWeekAndMonth(queryClient: QueryClient) {
  clearAttendanceCaches();
  void queryClient.resetQueries({ queryKey: [...attendanceKeys.all, 'week'] });
  void queryClient.resetQueries({ queryKey: [...attendanceKeys.all, 'month'] });
}

/**
 * 出勤簿が変わりうる操作の後の読み直し(GAS版 invalidatePastScheduleWeekCache_ → loadPastSchedule →
 * loadWeekEvents(true))。localStorage のキャッシュを捨て、表示中の週間予定・1日分・今月のまとめを
 * 読み直す(GAS版は今月のまとめはキャッシュを捨てるだけで、開いたままのまとめは古い内容のままだった)。
 */
export function useAttendanceInvalidation() {
  const queryClient = useQueryClient();
  const { staffKey } = useAttendanceTarget();

  const reloadAfterChange = useCallback(() => {
    resetWeekAndMonth(queryClient);
    void queryClient.invalidateQueries({ queryKey: [...attendanceKeys.all, 'day'] });
  }, [queryClient]);

  /** 週間予定のキャッシュを捨てて読み直し、選択中の日も読み直して結果を返す(GAS版 reloadPastScheduleFromSpreadsheet_) */
  const reloadDayAndWeek = useCallback(
    async (date: string): Promise<AttendanceDay | null> => {
      resetWeekAndMonth(queryClient);
      return refetchDay(queryClient, attendanceKeys.day(staffKey, date));
    },
    [queryClient, staffKey],
  );

  /** 今月のまとめを読み直す(「🔄 最新にする」) */
  const reloadMonth = useCallback(
    (yearMonth: string) => {
      clearMonthCache(staffKey, yearMonth);
      void queryClient.resetQueries({ queryKey: attendanceKeys.month(staffKey, yearMonth), exact: true });
    },
    [queryClient, staffKey],
  );

  /** 今月のまとめを全て読み直す(領収書を取消したとき。領収書の合計が変わる) */
  const reloadMonths = useCallback(() => {
    clearMonthlyCaches();
    void queryClient.resetQueries({ queryKey: [...attendanceKeys.all, 'month'] });
  }, [queryClient]);

  return { reloadAfterChange, reloadDayAndWeek, reloadMonth, reloadMonths };
}

function clearMonthCache(staffKey: string, yearMonth: string) {
  removeStorage(monthCacheKey(staffKey, yearMonth));
}
