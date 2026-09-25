import { getBrowserStorage, type KeyValueStorage, readStorage, STORAGE_KEYS } from '../../lib/storage';

/**
 * お客様一覧の絞り込みと並び順(GAS版 filterCustomers)。
 * - 地区: 完全一致。名前: 大文字小文字を区別しない部分一致。
 * - どちらも指定していないときだけ、最近日報を書いたお客様(recent_customers の順)を上にする。
 *   それ以外のお客様はサーバーから届いた順のまま(安定ソート)。
 */
export interface CustomerFilter {
  search: string;
  city: string;
}

export function filterCustomers<T extends { id: string; name: string; city: string | null }>(
  customers: readonly T[],
  { search, city }: CustomerFilter,
  recentIds: readonly string[],
): T[] {
  const needle = search.toLowerCase();
  const filtered = customers.filter((c) => {
    const matchesCity = city ? c.city === city : true;
    const matchesSearch = c.name.toLowerCase().includes(needle);
    return matchesCity && matchesSearch;
  });
  if (search || city) return filtered;

  const rank = new Map<string, number>();
  recentIds.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index);
  });
  const rankOf = (c: T) => rank.get(c.id) ?? Number.POSITIVE_INFINITY;
  return filtered.sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    return ra === rb ? 0 : ra - rb;
  });
}

/** 最近日報を書いたお客様のID(新しい順、最大50件。書きこむのは日報の保存処理)。壊れていたら空。 */
export function readRecentCustomerIds(storage: KeyValueStorage | null = getBrowserStorage()): string[] {
  const raw = readStorage(STORAGE_KEYS.recentCustomers, storage);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
