import {
  getBrowserStorage,
  type KeyValueStorage,
  readStorage,
  STORAGE_KEYS,
  type UserStorageScope,
  userStorageKey,
  writeStorage,
} from './storage';

/**
 * 「最近日報を書いたお客様」(GAS版 recent_customers。お客様タブの並び替えに使う)。
 * 値はお客様IDの配列(新しい順・50件まで)で、ログインしている人ごとに持つ(userStorageKey)。
 * 日報・領収書を送ったときに先頭に入れ(pushRecentCustomer)、お客様タブは絞り込みを変えるたびに読む
 * (GAS版 filterCustomers と同じ)。
 */
const MAX_RECENT = 50;

const keyOf = (scope: UserStorageScope) => userStorageKey(STORAGE_KEYS.recentCustomers, scope);

/** 読む。壊れていたら空 */
export function readRecentCustomerIds(
  scope: UserStorageScope,
  storage: KeyValueStorage | null = getBrowserStorage(),
): string[] {
  const raw = readStorage(keyOf(scope), storage);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** 先頭に入れる(同じお客様は前の位置から消す) */
export function pushRecentCustomer(
  customerId: string,
  scope: UserStorageScope,
  storage: KeyValueStorage | null = getBrowserStorage(),
) {
  const list = readRecentCustomerIds(scope, storage).filter((x) => x !== customerId);
  list.unshift(customerId);
  if (list.length > MAX_RECENT) list.length = MAX_RECENT;
  writeStorage(keyOf(scope), JSON.stringify(list), storage);
}
