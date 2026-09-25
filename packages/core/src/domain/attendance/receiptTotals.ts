/**
 * 勤怠の月次まとめに出す領収書金額の集計(GAS版 PastSchedule.js の getReceiptsForMonth_)。
 */

export interface ReceiptAmountEntry {
  /** 領収書日時のJST暦日 'YYYY-MM-DD' */
  businessDate: string;
  /** 金額(OCR結果・手入力の文字列) */
  amount: string;
}

export interface ReceiptTotals {
  byDay: Record<string, number>;
  total: number;
}

/**
 * 金額文字列を数値にする。GAS版は領収書ログシートのセル値を Number() していた
 * (シートが「1,200」等を数値セルに自動変換するため桁区切りも数値になる)。同じ結果になるよう
 * 桁区切り・通貨記号・空白を取り除いてから数値化し、数値にならなければ0とする。
 */
export function parseReceiptAmount(amount: string): number {
  const normalized = amount.replace(/[,，\s円¥￥]/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

export function summarizeReceiptAmounts(entries: readonly ReceiptAmountEntry[]): ReceiptTotals {
  const byDay: Record<string, number> = {};
  let total = 0;
  for (const entry of entries) {
    const amount = parseReceiptAmount(entry.amount);
    byDay[entry.businessDate] = (byDay[entry.businessDate] ?? 0) + amount;
    total += amount;
  }
  return { byDay, total };
}
