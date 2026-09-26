import { describe, expect, it } from 'vitest';
import { summarizeReceiptAmounts } from './receiptTotals';

describe('領収書金額の集計(GAS版 getReceiptsForMonth_ + 会社負担の内訳)', () => {
  it('日別と月合計を返す(会社負担も合計に入れ、内訳を別に返す)', () => {
    expect(
      summarizeReceiptAmounts([
        { businessDate: '2026-09-01', amountYen: 500, companyPaid: false },
        { businessDate: '2026-09-01', amountYen: 1000, companyPaid: true },
        { businessDate: '2026-09-03', amountYen: 300, companyPaid: true },
        { businessDate: '2026-09-04', amountYen: 0, companyPaid: false },
      ]),
    ).toEqual({
      byDay: { '2026-09-01': 1500, '2026-09-03': 300, '2026-09-04': 0 },
      total: 1800,
      companyPaidByDay: { '2026-09-01': 1000, '2026-09-03': 300 },
      companyPaid: 1300,
      customerBillable: 500,
    });
  });

  it('領収書が無ければ全て0', () => {
    expect(summarizeReceiptAmounts([])).toEqual({
      byDay: {},
      total: 0,
      companyPaidByDay: {},
      companyPaid: 0,
      customerBillable: 0,
    });
  });
});
