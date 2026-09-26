import {
  type KeyValueStorage,
  readStorage,
  removeStorageByPrefix,
  STORAGE_KEYS,
  writeStorage,
} from '../../../lib/storage';

/**
 * 週間予定・今月のまとめの、この端末だけの2時間キャッシュ(GAS版 pastSchedWeek_* / attendanceMonthly_*)。
 * 出勤簿の内容が変わりうる操作(保存・カレンダーから取り込む)の後は両方まとめて消す
 * (GAS版 invalidatePastScheduleWeekCache_)。
 */
export const CACHE_TTL_MS = 2 * 60 * 60 * 1000;

export interface Cached<T> {
  value: T;
  /** 読み込んだ時刻(「HH:MM 時点」に出す) */
  ts: number;
}

const normalize = (s: string) => s.replace(/\s+/g, '');

export const weekCacheKey = (staffKey: string, weekStart: string) =>
  `${STORAGE_KEYS.pastScheduleWeekCachePrefix}${normalize(staffKey)}_${weekStart}`;

export const monthCacheKey = (staffKey: string, yearMonth: string) =>
  `${STORAGE_KEYS.attendanceMonthlyCachePrefix}${normalize(staffKey)}_${yearMonth}`;

/** GAS版と同じ形({ events, ts } / { res, ts })で保存する。 */
type Field = 'events' | 'res';

export function readCache<T>(
  key: string,
  field: Field,
  now = Date.now(),
  storage?: KeyValueStorage | null,
): Cached<T> | null {
  const raw = readStorage(key, storage);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> & { ts?: number };
    if (!parsed?.ts || now - parsed.ts > CACHE_TTL_MS || !(field in parsed)) return null;
    return { value: parsed[field] as T, ts: parsed.ts };
  } catch {
    return null;
  }
}

export function writeCache<T>(
  key: string,
  field: Field,
  value: T,
  ts = Date.now(),
  storage?: KeyValueStorage | null,
) {
  writeStorage(key, JSON.stringify({ [field]: value, ts }), storage);
}

/** 今月のまとめのキャッシュをすべて消す(領収書を取消したとき。合計が変わるため) */
export function clearMonthlyCaches() {
  removeStorageByPrefix(STORAGE_KEYS.attendanceMonthlyCachePrefix);
}

/** 週間予定・今月のまとめのキャッシュをすべて消す */
export function clearAttendanceCaches() {
  removeStorageByPrefix(STORAGE_KEYS.pastScheduleWeekCachePrefix);
  removeStorageByPrefix(STORAGE_KEYS.attendanceMonthlyCachePrefix);
}
