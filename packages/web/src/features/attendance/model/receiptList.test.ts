import { describe, expect, it } from 'vitest';
import {
  formatReceiptDateTime,
  receiptAmountLabel,
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
});
