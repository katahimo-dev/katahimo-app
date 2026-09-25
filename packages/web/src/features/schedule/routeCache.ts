import type { ScheduleWithRouteResponse } from '@katahimo/shared';
import {
  getBrowserStorage,
  type KeyValueStorage,
  readStorage,
  STORAGE_KEYS,
  writeStorage,
} from '../../lib/storage';

/**
 * ルートつき予定のブラウザ内キャッシュ(GAS版 getCachedRoute / setCachedRoute)。
 * 地図APIの呼び出し(10秒ほどかかる)を減らすため、同じスタッフ・同じ日の結果を2時間使い回す。
 * このブラウザだけのキャッシュで、他の人・他の端末とは共有しない(サーバー側にも別の共有キャッシュがある)。
 */
export const ROUTE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export interface CachedRoute {
  res: ScheduleWithRouteResponse;
  /** 調べた時刻(ミリ秒)。「HH:MM 時点」に使う */
  ts: number;
}

export function routeCacheKey(staffId: string, dateStr: string): string {
  return `${STORAGE_KEYS.scheduleRouteCachePrefix}${staffId}_${dateStr}`;
}

export function readCachedRoute(
  staffId: string,
  dateStr: string,
  now: number = Date.now(),
  storage: KeyValueStorage | null = getBrowserStorage(),
): CachedRoute | null {
  const raw = readStorage(routeCacheKey(staffId, dateStr), storage);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CachedRoute> | null;
    if (!parsed || typeof parsed.ts !== 'number' || !parsed.res) return null;
    if (now - parsed.ts > ROUTE_CACHE_TTL_MS) return null;
    return { res: parsed.res, ts: parsed.ts };
  } catch {
    return null;
  }
}

export function writeCachedRoute(
  staffId: string,
  dateStr: string,
  res: ScheduleWithRouteResponse,
  now: number = Date.now(),
  storage: KeyValueStorage | null = getBrowserStorage(),
) {
  writeStorage(routeCacheKey(staffId, dateStr), JSON.stringify({ res, ts: now }), storage);
}
