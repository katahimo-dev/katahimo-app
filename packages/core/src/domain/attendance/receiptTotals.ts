/**
 * 勤怠の月次まとめに出す領収書金額の集計(GAS版 PastSchedule.js の getReceiptsForMonth_ に、会社負担の内訳を足したもの)。
 * 取消済みの領収書は呼び出し側で除いてから渡す。
 */

export interface ReceiptAmountEntry {
  /** 領収書日時のテナントの暦日 'YYYY-MM-DD' */
  businessDate: string;
  /** 金額(円) */
  amountYen: number;
  /** 会社負担(お客様に請求しない)か */
  companyPaid: boolean;
}

export interface ReceiptTotals {
  /** 日別の合計(会社負担を含む。スタッフへの支払いの額) */
  byDay: Record<string, number>;
  /** 月の合計(会社負担を含む。スタッフへの支払いの額) */
  total: number;
  /** 日別の、うち会社負担 */
  companyPaidByDay: Record<string, number>;
  /** 月の、うち会社負担(お客様に請求しない額) */
  companyPaid: number;
  /** 月の、お客様に請求する額(合計 − 会社負担) */
  customerBillable: number;
}

export function summarizeReceiptAmounts(entries: readonly ReceiptAmountEntry[]): ReceiptTotals {
  const byDay: Record<string, number> = {};
  const companyPaidByDay: Record<string, number> = {};
  let total = 0;
  let companyPaid = 0;
  for (const entry of entries) {
    byDay[entry.businessDate] = (byDay[entry.businessDate] ?? 0) + entry.amountYen;
    total += entry.amountYen;
    if (entry.companyPaid) {
      companyPaidByDay[entry.businessDate] = (companyPaidByDay[entry.businessDate] ?? 0) + entry.amountYen;
      companyPaid += entry.amountYen;
    }
  }
  return { byDay, total, companyPaidByDay, companyPaid, customerBillable: total - companyPaid };
}
