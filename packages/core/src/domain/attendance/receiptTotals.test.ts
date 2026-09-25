import { describe, expect, it } from 'vitest';
import { parseReceiptAmount, summarizeReceiptAmounts } from './receiptTotals';

describe('領収書金額の集計(GAS版 getReceiptsForMonth_)', () => {
  it('桁区切り・円記号付きも数値として読み、読めないものは0円', () => {
    expect(parseReceiptAmount('1,200')).toBe(1200);
    expect(parseReceiptAmount('¥ 980円')).toBe(980);
    expect(parseReceiptAmount('')).toBe(0);
    expect(parseReceiptAmount('不明')).toBe(0);
  });

  it('日別と月合計を返す', () => {
    expect(
      summarizeReceiptAmounts([
        { businessDate: '2026-09-01', amount: '500' },
        { businessDate: '2026-09-01', amount: '1,000' },
        { businessDate: '2026-09-03', amount: 'x' },
      ]),
    ).toEqual({ byDay: { '2026-09-01': 1500, '2026-09-03': 0 }, total: 1500 });
  });
});
