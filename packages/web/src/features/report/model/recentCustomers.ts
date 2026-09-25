import { type KeyValueStorage, readStorage, STORAGE_KEYS, writeStorage } from '../../../lib/storage';

const MAX_RECENT = 50;

/**
 * 日報・領収書を送ったお客様を「最近のお客様」の先頭に入れる(GAS版 executeSave / uploadReceiptsOnly の
 * recent_customers の更新。お客様タブの並び替えに使われる)。値はお客様IDの配列(新しい順・50件まで)。
 */
export function pushRecentCustomer(customerId: string, storage?: KeyValueStorage | null) {
  let recent: unknown;
  try {
    recent = JSON.parse(readStorage(STORAGE_KEYS.recentCustomers, storage) || '[]');
  } catch {
    recent = [];
  }
  const list = Array.isArray(recent) ? recent.filter((x) => x !== customerId) : [];
  list.unshift(customerId);
  if (list.length > MAX_RECENT) list.pop();
  writeStorage(STORAGE_KEYS.recentCustomers, JSON.stringify(list), storage);
}
