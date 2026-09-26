import { describe, expect, it } from 'vitest';
import {
  formatReceiptDateTime,
  receiptAmountLabel,
  receiptBreakdownLabels,
  receiptCancellationLabel,
  receiptCustomerLabel,
  receiptSummaryLabel,
} from './receiptList';

describe('領収書の一覧の表示', () => {
  it('領収書日時はテナントのタイムゾーンの「M/D(曜) HH:mm」', () => {
    // 2026-09-09T15:30Z は日本時間 9/10(木) 0:30
    expect(formatReceiptDateTime('2026-09-09T15:30:00.000Z', 'Asia/Tokyo')).toBe('9/10(木) 00:30');
  });

  it('お客様・金額・合計の表示', () => {
    expect(receiptCustomerLabel({ customerName: null })).toBe('お客様の指定なし');
    expect(receiptCustomerLabel({ customerName: '佐藤 花子' })).toBe('佐藤 花子');
    expect(receiptAmountLabel(null)).toBe('金額なし');
    expect(receiptAmountLabel(1200)).toBe('1,200円');
    expect(receiptSummaryLabel({ count: 3, totalYen: 1500, noAmountCount: 0 })).toBe('3件 合計 1,500円');
    expect(receiptSummaryLabel({ count: 3, totalYen: 1500, noAmountCount: 1 })).toBe(
      '3件 合計 1,500円(うち金額なし1件)',
    );
  });

  it('合計の内訳(会社負担・取消済みがあるときだけ)と取消の表示', () => {
    expect(
      receiptBreakdownLabels({ companyPaidYen: 0, customerBillableYen: 1500, cancelledCount: 0 }),
    ).toEqual([]);
    expect(
      receiptBreakdownLabels({ companyPaidYen: 600, customerBillableYen: 900, cancelledCount: 2 }),
    ).toEqual(['うち会社負担 600円 ／ お客様請求 900円', '取消 2件(合計に入れていません)']);
    const cancellation = {
      cancelledAt: '2026-09-11T00:30:00.000Z',
      cancelledByName: '山田 太郎',
      reason: null,
    };
    expect(receiptCancellationLabel(cancellation, 'Asia/Tokyo')).toBe('取消 9/11(金) 09:30 山田 太郎');
    expect(receiptCancellationLabel({ ...cancellation, cancelledByName: null }, 'Asia/Tokyo')).toBe(
      '取消 9/11(金) 09:30',
    );
  });
});
