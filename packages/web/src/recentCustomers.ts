const STORAGE_KEY = 'recent_customers';
const MAX_ENTRIES = 50;

/**
 * 「最近使った顧客」のID一覧(新しい順)。GAS版index.htmlのlocalStorage 'recent_customers'と
 * 同じキー・同じ配列形式(先頭が最新)。訪問先一覧の既定表示(検索/地区絞り込み無し時)の
 * 並び替えに使う。
 */
export function getRecentCustomerIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * 顧客IDを「最近使った」の先頭に記録する。GAS版のsaveReport/saveAccidentReport/
 * uploadReceiptsOnly成功時の更新ロジック(既存エントリを除去してから先頭に追加、50件で打ち切り)
 * と同じ。
 */
export function markCustomerRecentlyUsed(customerId: string): void {
  try {
    const recent = getRecentCustomerIds().filter((id) => id !== customerId);
    recent.unshift(customerId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_ENTRIES)));
  } catch {
    // localStorageが使えない環境(プライベートブラウジング等)では並び替えのヒントが
    // 効かないだけなので、保存失敗は無視してよい。
  }
}
