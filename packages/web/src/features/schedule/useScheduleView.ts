import type { ScheduleLightResponse, ScheduleWithRouteResponse } from '@katahimo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isUnauthenticated, userMessageOf } from '../../api/client';
import { type ScheduleRequest, scheduleApi } from '../../api/schedule';
import { useAdminTargetStaff } from '../../app/adminTargetStaff';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { useTodayJst } from '../../lib/useTodayJst';
import { showErrorToast, showToast } from '../../ui/toast';
import { type CachedRoute, readCachedRoute, writeCachedRoute } from './routeCache';
import {
  formatRouteFetchedAt,
  type ScheduleDate,
  type ScheduleOffset,
  scheduleDateFor,
} from './scheduleDate';
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
  /** 調べている間(🔄 を押せなくする。前に調べた結果を出したまま裏で最新を調べている間も含む) */
  routeLoading: boolean;
  /** 「調べています…（10秒ほど）」と出す間(🔄 を押したとき・何も出せずに待っているとき) */
  routeBlocking: boolean;
  /** ルートを調べた時刻(「HH:MM 時点」)。ルートなしの予定を出しているときは null */
  routeFetchedAt: number | null;
  /**
   * 出している予定が最新か: fresh = いま調べた結果 / revalidating = 前に調べた結果を出したまま最新を調べている /
   * stale = 最新を調べられず、前に調べた結果を出している / partial = 読めないカレンダーがあった結果(予定が欠けているかも)。
   * 予定を出していないときは null
   */
  routeFreshness: RouteFreshness | null;
  /** ☀️ 今日 / 🌙 明日(同じ日をもう一度押しても読み直す。GAS版 loadSchedule) */
  selectDay: (offset: ScheduleOffset) => void;
  /** 🔄 最新にする(GAS版 loadRouteInfo()。サーバーの地図の結果のキャッシュも使わずに調べ直す) */
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

export type RouteFreshness = 'fresh' | 'revalidating' | 'stale' | 'partial';

/** ルートを調べられなかった(サーバーが success:false を返した) */
class RouteUnavailableError extends Error {}

/** 読めないカレンダーがあった結果のため、前の表示を置き換えなかった(お知らせは出し済み) */
class PartialScheduleError extends Error {}

/** 画面に戻ったとき(visibilitychange)の読み直しを間引く間隔。前に調べて(失敗も含む)からこれより短ければ読まない */
export const SCHEDULE_REFOCUS_INTERVAL_MS = 60_000;

/** 前の表示と比べる予定の中身(種別・時刻・お客様・住所。所要時間・距離・経路のURLは比べない) */
function appointmentsDigest(res: ScheduleWithRouteResponse): string {
  return JSON.stringify(
    (res.appointments ?? []).map((a) => [a.eventType, a.startTime, a.endTime, a.customerName, a.address]),
  );
}

/** 最新を調べられなかったときのお知らせ。前に調べた結果を出したままなら、いつの時点の表示かを添える */
function routeFailureMessage(message: string, shown: CachedRoute | null | undefined): string {
  if (!shown) return message;
  return `${message.replace(/。$/, '')}。${formatRouteFetchedAt(shown.ts)}の表示のままです`;
}

const PARTIAL_WITHOUT_PREVIOUS_MESSAGE =
  '一部のカレンダーを読み込めなかったため、予定が欠けているかもしれません';
const PARTIAL_MESSAGE = '一部のカレンダーを読み込めませんでした';

/**
 * 届いた最新の結果を出すかどうか決める(自動の読み込みと 🔄 で同じ)。
 * - 読めないカレンダーがあった(partial): 前の表示があれば置き換えず(null)、端末の値も上書きしない。前の表示が無ければ
 *   欠けているかもしれない旨を添えて出す(端末には書かない)。
 * - それ以外: 端末の値を上書きし、前の表示と予定の中身が違えば「最新の予定に更新しました」。
 * notify が false(切り替えた後・予定タブが隠れている)ならお知らせを出さない。
 */
function acceptLatest(
  staffKey: string,
  date: string,
  res: ScheduleWithRouteResponse,
  shown: CachedRoute | null | undefined,
  notify: boolean,
): CachedRoute | null {
  const ts = Date.now();
  if (res.partial) {
    if (shown) {
      if (notify) showToast(routeFailureMessage(PARTIAL_MESSAGE, shown), true);
      return null;
    }
    if (notify) showToast(PARTIAL_WITHOUT_PREVIOUS_MESSAGE, true);
    return { res, ts };
  }
  writeCachedRoute(staffKey, date, res, ts);
  if (notify && shown && appointmentsDigest(shown.res) !== appointmentsDigest(res)) {
    showToast('最新の予定に更新しました');
  }
  return { res, ts };
}

/** 最新を調べられなかったときのお知らせ(自動の読み込みと 🔄 で同じ文言) */
function notifyRouteFailure(error: unknown, shown: CachedRoute | null | undefined) {
  if (error instanceof PartialScheduleError) return;
  if (error instanceof RouteUnavailableError) {
    showToast(routeFailureMessage(error.message, shown), true);
    return;
  }
  console.error('GET /api/schedule/route failed:', userMessageOf(error), error);
  if (shown && !isUnauthenticated(error)) showToast(routeFailureMessage(userMessageOf(error), shown), true);
  else showErrorToast(error);
}

export interface ScheduleViewOptions {
  /**
   * 予定タブが前に出ているか(下タブで隠れている間は画面に戻っても読み直さず、予定タブに戻ったときに読み直す)。
   * 省略時は true。
   */
  active?: boolean;
}

/**
 * 「今日の予定」タブの読み込みの流れ(GAS版 loadScheduleForOffset_ / loadRouteInfo /
 * loadPlainScheduleOnRouteFailure_)。TanStack Query で持つ:
 *
 * 1. 日付・表示するスタッフが決まったら、このブラウザに前に調べた結果があれば「HH:MM 時点」を添えてすぐ出し、
 *    同時に必ずサーバーへ最新を取りに行って差し替える(stale-while-revalidate。担当変更をすぐ出すため、
 *    ブラウザのキャッシュがあってもサーバーに問い合わせる。サーバーは予定を毎回カレンダーから読む)。
 * 2. 予定タブに戻ってきたときも最新を取りに行く。画面に戻ってきたとき(visibilitychange)・通信が戻ったときは、
 *    予定タブが前に出ていて、前に調べてから60秒以上たっていれば取りに行く(サーバーのカレンダーの読み込みを増やさない)。
 * 3. 最新を調べられなかったとき、前に調べた結果を出していればそのまま残し、赤いお知らせでその旨と時点を知らせる。
 *    何も出していなければ赤いお知らせを出し、ルートなしの予定だけでも出す(従来どおり。ルートなしを出している間に
 *    また読み込んでも一覧は消さない)。読めないカレンダーがあった結果(partial)は前の表示を置き換えない。
 *    お知らせは予定タブが前に出ているときだけ出す。
 * 4. 「🔄 最新にする」はサーバーの地図の結果のキャッシュも使わずに調べ直す。失敗したときは、お知らせだけ出して
 *    今の表示を残す。
 * 日付・スタッフを切り替えたら、前の要求は取り消す(応答が届いても出さない)。StrictMode で2回描画されても、
 * 同じ要求は1回だけ送る(地図APIの呼び出しを増やさない)。
 * 5. 開いたまま日付をまたいだら、選んでいる ☀️今日 / 🌙明日 を今の日付で読み直す(前の日の予定を出し続けない)。
 */
export function useScheduleView({ active = true }: ScheduleViewOptions = {}): ScheduleView {
  const queryClient = useQueryClient();
  const { targetStaffId, requestStaffId } = useAdminTargetStaff();
  // 通知のリンク(`/?schedule=YYYY-MM-DD`)で起動したら、最初からその日を出す(今日の予定を先に調べない)
  const [offset, setOffset] = useState<ScheduleOffset>(() => initialScheduleOffset());
  const [date, setDate] = useState(() => scheduleDateFor(offset));
  const request: ScheduleRequest = { date: date.dateStr, staffId: requestStaffId };
  const routeKey = scheduleKeys.route(targetStaffId, date.dateStr);

  /** いま画面に出している結果(TanStack Query に無ければ、このブラウザに前に調べた結果) */
  const shownRouteOf = (staffKey: string, dateStr: string) =>
    queryClient.getQueryData<CachedRoute>(scheduleKeys.route(staffKey, dateStr)) ??
    readCachedRoute(staffKey, dateStr);

  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  });

  const routeQuery = useQuery({
    queryKey: routeKey,
    queryFn: async ({ signal }): Promise<CachedRoute> => {
      // 切り替えて取り消した要求・予定タブが隠れている間の読み込みは知らせない
      const notify = () => !signal.aborted && activeRef.current;
      try {
        const res = await scheduleApi.getWithRoute(request, false, signal);
        if (!res.success) throw new RouteUnavailableError(res.message || 'ルートを調べられませんでした');
        if (signal.aborted) return { res, ts: Date.now() };
        const shown = shownRouteOf(targetStaffId, request.date);
        const accepted = acceptLatest(targetStaffId, request.date, res, shown, notify());
        if (!accepted) throw new PartialScheduleError(PARTIAL_MESSAGE);
        return accepted;
      } catch (error) {
        if (notify()) notifyRouteFailure(error, shownRouteOf(targetStaffId, request.date));
        throw error;
      }
    },
    // 開くたびに最新を取りに行く(予定はカレンダーの担当変更をすぐ出したい。地図の結果はサーバーが区間ごとに
    // キャッシュするため、読み直しても地図APIの呼び出しはほとんど増えない)。画面に戻ったとき・通信が戻ったときは
    // 予定タブが前に出ていて、前に調べて(失敗も含む)から60秒以上たっているときだけ
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: (query) =>
      active &&
      Date.now() - Math.max(query.state.dataUpdatedAt, query.state.errorUpdatedAt) >=
        SCHEDULE_REFOCUS_INTERVAL_MS,
    refetchOnReconnect: active,
    retry: false,
  });

  // 最新が届くまで(または届かなかったとき)は、このブラウザに前に調べた結果を出す
  const hasFreshData = routeQuery.data !== undefined;
  const storedRoute = useMemo(
    () => (hasFreshData ? null : readCachedRoute(targetStaffId, date.dateStr)),
    [hasFreshData, targetStaffId, date.dateStr],
  );
  const shownRoute = routeQuery.data ?? storedRoute;

  // 予定タブに戻ってきたら最新を取りに行く(下タブの切り替えでは画面が作り直されないため)
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.route(targetStaffId, date.dateStr) });
    }
    wasActive.current = active;
  }, [active, queryClient, targetStaffId, date.dateStr]);

  // ルートつきの予定を自動で調べられなかったときだけ、ルートなしの予定を読む
  const routeFailed = routeQuery.isError && !routeQuery.isFetching && !shownRoute;
  const plainQuery = useQuery({
    queryKey: scheduleKeys.plain(targetStaffId, date.dateStr),
    queryFn: ({ signal }) =>
      scheduleApi.get(request, signal).catch((error: unknown) => {
        if (!signal.aborted) console.error('GET /api/schedule failed:', error);
        throw error;
      }),
    enabled: routeFailed,
    // ルートなしを出している間にルートつきを読み直しても、読んだ一覧は出し続ける(下の list)
    staleTime: 60_000,
    retry: false,
  });

  /** いま表示している要求(🔄 の結果が届いたとき、切り替えたあとならお知らせは出さない) */
  const currentKeyRef = useRef('');
  const currentKey = routeKey.join('\u0000');
  useEffect(() => {
    currentKeyRef.current = currentKey;
  });

  // 🔄 の要求は画面を離れたら(ログアウトを含む)取り消し、届いても端末に書き戻さない
  const refreshAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => refreshAbortRef.current?.abort(), []);

  const refresh = useMutation({
    mutationFn: (vars: { staffKey: string; request: ScheduleRequest; keyId: string; signal: AbortSignal }) =>
      scheduleApi.getWithRoute(vars.request, true, vars.signal),
    onSuccess: (res, vars) => {
      if (vars.signal.aborted) return;
      const notify = currentKeyRef.current === vars.keyId && activeRef.current;
      const shown = shownRouteOf(vars.staffKey, vars.request.date);
      if (!res.success) {
        if (notify)
          notifyRouteFailure(new RouteUnavailableError(res.message || 'ルートを調べられませんでした'), shown);
        return;
      }
      const accepted = acceptLatest(vars.staffKey, vars.request.date, res, shown, notify);
      if (accepted)
        queryClient.setQueryData<CachedRoute>(scheduleKeys.route(vars.staffKey, vars.request.date), accepted);
    },
    onError: (error, vars) => {
      if (vars.signal.aborted || currentKeyRef.current !== vars.keyId || !activeRef.current) return;
      notifyRouteFailure(error, shownRouteOf(vars.staffKey, vars.request.date));
    },
  });

  let list: ScheduleListState = { kind: 'loading' };
  if (shownRoute) {
    list = listFromRoute(shownRoute.res);
  } else if (plainQuery.data) {
    list = listFromPlain(plainQuery.data);
  } else if (routeFailed && plainQuery.isError && !plainQuery.isFetching) {
    list = { kind: 'error', message: NETWORK_ERROR_MESSAGE };
  }

  const refreshing = refresh.isPending && refresh.variables?.keyId === currentKey;

  // ☀️ / 🌙: 同じ日をもう一度押しても、このブラウザに前に調べた結果を出すところから読み直す(GAS版 loadSchedule)
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

  /** 出している日付が、選んでいる ☀️今日 / 🌙明日 の今の日付とずれていたら読み直す(ずれていたら true) */
  const reloadIfDateChanged = useCallback((): boolean => {
    if (scheduleDateFor(offset).dateStr === date.dateStr) return false;
    selectDay(offset);
    showToast('日付が変わったので、予定を読み込み直しました');
    return true;
  }, [offset, date.dateStr, selectDay]);

  // 開いたまま日付をまたいだとき(画面に戻ってきたとき・開いている間の確認)
  const today = useTodayJst();
  // biome-ignore lint/correctness/useExhaustiveDependencies: 日付が変わったときだけ確かめる
  useEffect(() => {
    reloadIfDateChanged();
  }, [today]);

  const { mutate } = refresh;
  const refreshRoute = useCallback(() => {
    // 🔄 を押したとき、日付をまたいでいたら前の日を調べ直さず、今の日付で読み直す
    if (reloadIfDateChanged()) return;
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    mutate({
      staffKey: targetStaffId,
      request: { date: date.dateStr, staffId: requestStaffId },
      keyId: currentKey,
      signal: controller.signal,
    });
  }, [reloadIfDateChanged, mutate, targetStaffId, date.dateStr, requestStaffId, currentKey]);

  return {
    offset,
    date,
    list,
    routeLoading: routeQuery.isFetching || refreshing,
    routeBlocking: refreshing || (routeQuery.isFetching && !shownRoute),
    routeFetchedAt: shownRoute?.ts ?? null,
    routeFreshness: freshnessOf(
      shownRoute,
      routeQuery.data !== undefined,
      routeQuery.isFetching || refreshing,
      routeQuery.isError,
    ),
    selectDay,
    refreshRoute,
  };
}

function freshnessOf(
  shown: CachedRoute | null,
  hasFreshData: boolean,
  fetching: boolean,
  failed: boolean,
): RouteFreshness | null {
  if (!shown) return null;
  if (fetching) return 'revalidating';
  if (failed || !hasFreshData) return 'stale';
  if (shown.res.partial) return 'partial';
  return 'fresh';
}
