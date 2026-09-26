import { formatZonedDateTime, type ReceiptListItem } from '@katahimo/shared';
import { WEEKDAY_LABELS, weekdayOfYmd } from '../../../lib/date';
import { formatYen } from './format';

/** 「全員」を選んだときの選択肢の値(スタッフIDと重ならない)。 */
export const ALL_STAFF = 'all';

/** 領収書日時 → 「9/10(水) 12:00」(テナントのタイムゾーン)。 */
export function formatReceiptDateTime(iso: string, timeZone: string): string {
  const [date = '', time = ''] = formatZonedDateTime(iso, timeZone).split(' ');
  const [, month = '', day = ''] = date.split('-');
  const weekday = WEEKDAY_LABELS[weekdayOfYmd(date)] ?? '';
  return `${Number(month)}/${Number(day)}(${weekday}) ${time.slice(0, 5)}`;
}

/** お客様の表示(未登録は入力された氏名、指定なしは「お客様の指定なし」)。 */
export function receiptCustomerLabel(item: Pick<ReceiptListItem, 'customerName'>): string {
  return item.customerName ?? 'お客様の指定なし';
}

/** 金額の表示(読めなかった・未入力は「金額なし」)。 */
export function receiptAmountLabel(amountYen: number | null): string {
  return amountYen === null ? '金額なし' : formatYen(amountYen);
}

/** 月の合計の表示。「3件 合計 1,500円(うち金額なし1件)」 */
export function receiptSummaryLabel(summary: {
  count: number;
  totalYen: number;
  noAmountCount: number;
}): string {
  const base = `${summary.count}件 合計 ${formatYen(summary.totalYen)}`;
  return summary.noAmountCount > 0 ? `${base}(うち金額なし${summary.noAmountCount}件)` : base;
}

/**
 * 月の合計の内訳。会社負担があれば「うち会社負担 600円 ／ お客様請求 900円」、取消済みがあれば
 * 「取消 1件(合計に入れていません)」。どちらも無ければ空の配列。
 */
export function receiptBreakdownLabels(summary: {
  companyPaidYen: number;
  customerBillableYen: number;
  cancelledCount: number;
}): string[] {
  const labels: string[] = [];
  if (summary.companyPaidYen > 0) {
    labels.push(
      `うち会社負担 ${formatYen(summary.companyPaidYen)} ／ お客様請求 ${formatYen(summary.customerBillableYen)}`,
    );
  }
  if (summary.cancelledCount > 0) labels.push(`取消 ${summary.cancelledCount}件(合計に入れていません)`);
  return labels;
}

/** 取消の表示「取消 9/25(木) 12:00 山田 太郎」(取消した人が削除されていれば名前を出さない)。 */
export function receiptCancellationLabel(
  cancellation: NonNullable<ReceiptListItem['cancellation']>,
  timeZone: string,
): string {
  const who = cancellation.cancelledByName ? ` ${cancellation.cancelledByName}` : '';
  return `取消 ${formatReceiptDateTime(cancellation.cancelledAt, timeZone)}${who}`;
}
