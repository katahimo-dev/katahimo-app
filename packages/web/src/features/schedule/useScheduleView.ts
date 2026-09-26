import type { ScheduleLightResponse, ScheduleWithRouteResponse } from '@katahimo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { userMessageOf } from '../../api/client';
import { type ScheduleRequest, scheduleApi } from '../../api/schedule';
import { useAdminTargetStaff } from '../../app/adminTargetStaff';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { showErrorToast, showToast } from '../../ui/toast';
import { type CachedRoute, readCachedRoute, writeCachedRoute } from './routeCache';
import { type ScheduleDate, type ScheduleOffset, scheduleDateFor } from './scheduleDate';
import { itemsFromPlainSchedule, itemsFromRouteSchedule, type ScheduleItem } from './scheduleItems';
import { initialScheduleOffset, onScheduleLink, scheduleOffsetForDate } from './scheduleLink';

/** 予定一覧の表示(読み込み中 / 予定(0件なら「予定はありません」) / 赤い文言) */
export type ScheduleListState =
  | { kind: 'loading' }
  | { kind: 'items'; items: ScheduleItem[] }
  | { kind: 'error'; message: string };

export interface ScheduleView {
  offset: ScheduleOffset;
  date: ScheduleDate;
  list: ScheduleListState;
  /** 「調べています…（10秒ほど）」の間(ボタンを押せなくする) */
  routeLoading: boolean;
  /** ルートを調べた時刻(「HH:MM 時点」)。ルートなしの予定を出しているときは null */
  routeFetchedAt: number | null;
  /** ☀️ 今日 / 🌙 明日(同じ日をもう一度押しても読み直す。GAS版 loadSchedule) */
  selectDay: (offset: ScheduleOffset) => void;
  /** 🔄 最新にする(GAS版 loadRouteInfo()。サーバーのキャッシュを使わずに調べ直す) */
  refreshRoute: () => void;
}

function listFromRoute(res: ScheduleWithRouteResponse): ScheduleListState {
  if (!res.success) return { kind: 'error', message: res.message || 'ルートを調べられませんでした' };
  return { kind: 'items', items: itemsFromRouteSchedule(res.appointments ?? []) };
}

function listFromPlain(res: ScheduleLightResponse): ScheduleListState {
  if (!res.success) return { kind: 'error', message: res.message || '予定を見られませんでした' };
  return { kind: 'items', items: itemsFromPlainSchedule(res.appointments ?? []) };
}

/** 予定タブのクエリキー(スタッフ・日付ごと。その下にルートつき・ルートなし) */
export const scheduleKeys = {
  all: ['schedule'] as const,
  day: (staffKey: string, date: string) => ['schedule', staffKey, date] as const,
  route: (staffKey: string, date: string) => ['schedule', staffKey, date, 'route'] as const,
  plain: (staffKey: string, date: string) => ['schedule', staffKey, date, 'plain'] as const,
};

/** ルートを調べられなかった(サーバーが success:false を返した) */
class RouteUnavailableError extends Error {}

/**
 * 「今日の予定」タブの読み込みの流れ(GAS版 loadScheduleForOffset_ / loadRouteInfo /
 * loadPlainScheduleOnRouteFailure_)。TanStack Query で持つ:
 *
 * 1. 日付・表示するスタッフが決まったら、まずこのブラウザの2時間キャッシュを見る。あればそのまま出す。
 * 2. 無ければルート・移動時間つきの予定を自動で調べる(10秒ほどかかる)。
 * 3. 自動で調べるのに失敗したら赤いお知らせを出し、ルートなしの予定だけでも出す。
 * 4. 「🔄 最新にする」はサーバーのキャッシュも使わずに調べ直す。失敗したときは、お知らせだけ出して
 *    今の表示を残す。
 * 日付・スタッフを切り替えたら、前の要求は取り消す(応答が届いても出さない)。StrictMode で2回描画されても、
 * 同じ要求は1回だけ送る(地図APIの呼び出しを増やさない)。
 */
export function useScheduleView(): ScheduleView {
  const queryClient = useQueryClient();
  const { targetStaffId, requestStaffId } = useAdminTargetStaff();
  // 通知のリンク(`/?schedule=YYYY-MM-DD`)で起動したら、最初からその日を出す(今日の予定を先に調べない)
  const [offset, setOffset] = useState<ScheduleOffset>(() => initialScheduleOffset());
  const [date, setDate] = useState(() => scheduleDateFor(offset));
  const request: ScheduleRequest = { date: date.dateStr, staffId: requestStaffId };
  const routeKey = scheduleKeys.route(targetStaffId, date.dateStr);

  const routeQuery = useQuery({
    queryKey: routeKey,
    queryFn: async ({ signal }): Promise<CachedRoute> => {
      const cached = readCachedRoute(targetStaffId, request.date);
      if (cached) return cached;
      try {
        const res = await scheduleApi.getWithRoute(request, false, signal);
        if (!res.success) throw new RouteUnavailableError(res.message || 'ルートを調べられませんでした');
        const ts = Date.now();
        writeCachedRoute(targetStaffId, request.date, res, ts);
        return { res, ts };
      } catch (error) {
        // 切り替えて取り消した要求は知らせない
        if (!signal.aborted) {
          if (error instanceof RouteUnavailableError) {
            showToast(error.message, true);
          } else {
            console.error('GET /api/schedule/route failed:', userMessageOf(error), error);
            showErrorToast(error);
          }
        }
        throw error;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  // ルートつきの予定を自動で調べられなかったときだけ、ルートなしの予定を読む
  const routeFailed = routeQuery.isError && !routeQuery.isFetching && !routeQuery.data;
  const plainQuery = useQuery({
    queryKey: scheduleKeys.plain(targetStaffId, date.dateStr),
    queryFn: ({ signal }) =>
      scheduleApi.get(request, signal).catch((error: unknown) => {
        if (!signal.aborted) console.error('GET /api/schedule failed:', error);
        throw error;
      }),
    enabled: routeFailed,
    staleTime: 0,
    retry: false,
  });

  /** いま表示している要求(🔄 の結果が届いたとき、切り替えたあとならお知らせは出さない) */
  const currentKeyRef = useRef('');
  const currentKey = routeKey.join('\u0000');
  useEffect(() => {
    currentKeyRef.current = currentKey;
  });

  const refresh = useMutation({
    mutationFn: (vars: { staffKey: string; request: ScheduleRequest; keyId: string }) =>
      scheduleApi.getWithRoute(vars.request, true),
    onSuccess: (res, vars) => {
      const isCurrent = currentKeyRef.current === vars.keyId;
      if (!res.success) {
        if (isCurrent) showToast(res.message || 'ルートを調べられませんでした', true);
        return;
      }
      const ts = Date.now();
      writeCachedRoute(vars.staffKey, vars.request.date, res, ts);
      queryClient.setQueryData<CachedRoute>(scheduleKeys.route(vars.staffKey, vars.request.date), {
        res,
        ts,
      });
    },
    onError: (error, vars) => {
      if (currentKeyRef.current !== vars.keyId) return;
      console.error('GET /api/schedule/route failed:', userMessageOf(error), error);
      showErrorToast(error);
    },
  });

  let list: ScheduleListState = { kind: 'loading' };
  if (routeQuery.data) {
    list = listFromRoute(routeQuery.data.res);
  } else if (routeFailed) {
    if (plainQuery.data) list = listFromPlain(plainQuery.data);
    else if (plainQuery.isError && !plainQuery.isFetching)
      list = { kind: 'error', message: NETWORK_ERROR_MESSAGE };
  }

  const refreshing = refresh.isPending && refresh.variables?.keyId === currentKey;

  // ☀️ / 🌙: 同じ日をもう一度押しても、キャッシュを見るところから読み直す(GAS版 loadSchedule)
  const selectDay = useCallback(
    (next: ScheduleOffset) => {
      const nextDate = scheduleDateFor(next);
      setOffset(next);
      setDate(nextDate);
      void queryClient.resetQueries({ queryKey: scheduleKeys.day(targetStaffId, nextDate.dateStr) });
    },
    [queryClient, targetStaffId],
  );

  // 開いている画面で通知を押したとき(Service Worker からの知らせ)は、その日を選び直す
  useEffect(() => onScheduleLink((linked) => selectDay(scheduleOffsetForDate(linked))), [selectDay]);

  const { mutate } = refresh;
  const refreshRoute = useCallback(() => {
    mutate({
      staffKey: targetStaffId,
      request: { date: date.dateStr, staffId: requestStaffId },
      keyId: currentKey,
    });
  }, [mutate, targetStaffId, date.dateStr, requestStaffId, currentKey]);

  return {
    offset,
    date,
    list,
    routeLoading: routeQuery.isFetching || refreshing,
    routeFetchedAt: routeQuery.data?.ts ?? null,
    selectDay,
    refreshRoute,
  };
}
