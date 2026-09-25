import type { ScheduleLightResponse, ScheduleWithRouteResponse } from '@katahimo/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { userMessageOf } from '../../api/client';
import { type ScheduleRequest, scheduleApi } from '../../api/schedule';
import { useAdminTargetStaff } from '../../app/adminTargetStaff';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { showErrorToast, showToast } from '../../ui/toast';
import { readCachedRoute, writeCachedRoute } from './routeCache';
import { type ScheduleDate, type ScheduleOffset, scheduleDateFor } from './scheduleDate';
import { itemsFromPlainSchedule, itemsFromRouteSchedule, type ScheduleItem } from './scheduleItems';

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

/**
 * 「今日の予定」タブの読み込みの流れ(GAS版 loadScheduleForOffset_ / loadRouteInfo /
 * loadPlainScheduleOnRouteFailure_):
 *
 * 1. 日付・表示するスタッフが決まったら、まずこのブラウザの2時間キャッシュを見る。あればそのまま出す。
 * 2. 無ければルート・移動時間つきの予定を自動で調べる(10秒ほどかかる)。
 * 3. 自動で調べるのに失敗したら赤いお知らせを出し、ルートなしの予定だけでも出す。
 *    「🔄 最新にする」で失敗したときは、お知らせだけ出して今の表示を残す。
 * 古い要求(日付・スタッフを切り替える前のもの)の応答は捨てる。
 */
export function useScheduleView(): ScheduleView {
  const { targetStaffId, requestStaffId } = useAdminTargetStaff();
  const [offset, setOffset] = useState<ScheduleOffset>(0);
  const [reloadCount, setReloadCount] = useState(0);
  const [date, setDate] = useState(() => scheduleDateFor(0));
  const [list, setList] = useState<ScheduleListState>({ kind: 'loading' });
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeFetchedAt, setRouteFetchedAt] = useState<number | null>(null);

  /** いま表示している要求。応答が届いたとき、これと違えば(切り替えたあとなら)捨てる */
  const currentRef = useRef<{ seq: number; request: ScheduleRequest; cacheStaffId: string } | null>(null);
  const seqRef = useRef(0);

  const loadPlainFallback = useCallback(async (seq: number, request: ScheduleRequest) => {
    const isCurrent = () => currentRef.current?.seq === seq;
    try {
      const res = await scheduleApi.get(request);
      if (isCurrent()) setList(listFromPlain(res));
    } catch (error) {
      if (!isCurrent()) return;
      console.error('GET /api/schedule failed:', error);
      setList({ kind: 'error', message: NETWORK_ERROR_MESSAGE });
    }
  }, []);

  const loadRoute = useCallback(
    async (isAutoLoad: boolean) => {
      const current = currentRef.current;
      if (!current) return;
      const { seq, request, cacheStaffId } = current;
      const isCurrent = () => currentRef.current?.seq === seq;
      setRouteLoading(true);
      try {
        const res = await scheduleApi.getWithRoute(request, !isAutoLoad);
        if (!isCurrent()) return;
        setRouteLoading(false);
        if (!res.success) {
          showToast(res.message || 'ルートを調べられませんでした', true);
          if (isAutoLoad) void loadPlainFallback(seq, request);
          return;
        }
        const now = Date.now();
        writeCachedRoute(cacheStaffId, request.date, res, now);
        setRouteFetchedAt(now);
        setList(listFromRoute(res));
      } catch (error) {
        if (!isCurrent()) return;
        setRouteLoading(false);
        console.error('GET /api/schedule/route failed:', userMessageOf(error), error);
        showErrorToast(error);
        if (isAutoLoad) void loadPlainFallback(seq, request);
      }
    },
    [loadPlainFallback],
  );

  // 日付・表示するスタッフが変わったとき(と、☀️/🌙 を押したとき)に読み直す。reloadCount は押した回数。
  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount は同じ日を押し直したときに読み直すためのきっかけ
  useEffect(() => {
    const nextDate = scheduleDateFor(offset);
    const request: ScheduleRequest = { date: nextDate.dateStr, staffId: requestStaffId };
    seqRef.current += 1;
    currentRef.current = { seq: seqRef.current, request, cacheStaffId: targetStaffId };

    setDate(nextDate);
    setRouteLoading(false);
    setRouteFetchedAt(null);
    setList({ kind: 'loading' });

    const cached = readCachedRoute(targetStaffId, nextDate.dateStr);
    if (cached) {
      setRouteFetchedAt(cached.ts);
      setList(listFromRoute(cached.res));
      return;
    }
    void loadRoute(true);
  }, [offset, reloadCount, targetStaffId, requestStaffId, loadRoute]);

  const selectDay = useCallback((next: ScheduleOffset) => {
    setOffset(next);
    setReloadCount((n) => n + 1);
  }, []);

  const refreshRoute = useCallback(() => {
    void loadRoute(false);
  }, [loadRoute]);

  return { offset, date, list, routeLoading, routeFetchedAt, selectDay, refreshRoute };
}
