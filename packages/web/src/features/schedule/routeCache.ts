import { type ScheduleWithRouteResponse, scheduleWithRouteResponseSchema } from '@katahimo/shared';
import { z } from 'zod';
import {
  getBrowserStorage,
  type KeyValueStorage,
  readStorage,
  removeStorage,
  STORAGE_KEYS,
  writeStorage,
} from '../../lib/storage';

/**
 * ルートつき予定のブラウザ内キャッシュ(GAS版 getCachedRoute / setCachedRoute に当たるが、使い方が違う)。
 * GAS版はキャッシュがあればサーバーに問い合わせなかったが、ここでは開いたときにすぐ出すための前回の結果
 * (stale-while-revalidate)で、出したあと必ずサーバーへ最新を取りに行き、届いたら差し替えてこの値も上書きする
 * (useScheduleView)。担当変更をすぐ出すため。前の晩に見た明日の予定を翌朝すぐ出せるよう、24時間まで使う
 * (「HH:MM 時点」を添えて出すため、古い値でも取り違えない)。
 * このブラウザだけのキャッシュで、他の人・他の端末とは共有しない。
 * 読むときは契約(zod)で確かめ、形が違う・古い値は使わない。書くときに期限切れの値を消す
 * (日付ごとにキーが増えていくため)。ログアウト・セッション切れのときはすべて消す(lib/storage.ts)。
 */
export const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface CachedRoute {
  res: ScheduleWithRouteResponse;
  /** 調べた時刻(ミリ秒)。「HH:MM 時点」に使う */
  ts: number;
}

export function routeCacheKey(staffId: string, dateStr: string): string {
  return `${STORAGE_KEYS.scheduleRouteCachePrefix}${staffId}_${dateStr}`;
}

const cachedRouteSchema = z.object({
  res: scheduleWithRouteResponseSchema,
  ts: z.number(),
});

function parseCachedRoute(raw: string | null, now: number): CachedRoute | null {
  if (!raw) return null;
  try {
    const parsed = cachedRouteSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || now - parsed.data.ts > ROUTE_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function readCachedRoute(
  staffId: string,
  dateStr: string,
  now: number = Date.now(),
  storage: KeyValueStorage | null = getBrowserStorage(),
): CachedRoute | null {
  return parseCachedRoute(readStorage(routeCacheKey(staffId, dateStr), storage), now);
}

type EnumerableStorage = KeyValueStorage & Pick<Storage, 'key' | 'length'>;

function isEnumerable(storage: KeyValueStorage | null): storage is EnumerableStorage {
  return storage !== null && 'key' in storage && 'length' in storage;
}

/** 期限切れ・壊れたルートのキャッシュを消す */
export function pruneCachedRoutes(
  now: number = Date.now(),
  storage: KeyValueStorage | null = getBrowserStorage(),
) {
  if (!isEnumerable(storage)) return;
  const stale: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith(STORAGE_KEYS.scheduleRouteCachePrefix)) continue;
      if (!parseCachedRoute(readStorage(key, storage), now)) stale.push(key);
    }
  } catch {
    return;
  }
  for (const key of stale) removeStorage(key, storage);
}

export function writeCachedRoute(
  staffId: string,
  dateStr: string,
  res: ScheduleWithRouteResponse,
  now: number = Date.now(),
  storage: KeyValueStorage | null = getBrowserStorage(),
) {
  pruneCachedRoutes(now, storage);
  writeStorage(routeCacheKey(staffId, dateStr), JSON.stringify({ res, ts: now }), storage);
}
