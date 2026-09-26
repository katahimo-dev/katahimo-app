import {
  type AttendanceRowData,
  computeDayDerived,
  computeMonthlyTotals,
  datesOfMonth,
  summarizeReceiptAmounts,
} from '@katahimo/core/domain';
import type { AttendanceExportReceipt, AttendanceExportStaff } from '@katahimo/core/usecases';

/**
 * テスト用: 出勤簿の書き出しの入力(今月のまとめと同じ計算で作る)。rowData を日付ごとに渡す。
 * 領収書の合計も loadAttendanceMonth と同じ規則(金額の無い領収書は入れない)。
 */
export function exportStaffFixture(
  name: string,
  yearMonth: string,
  rows: Record<string, AttendanceRowData>,
  receipts: AttendanceExportReceipt[] = [],
): AttendanceExportStaff {
  const days = datesOfMonth(yearMonth).map((businessDate) => {
    const rowData = rows[businessDate] ?? {};
    return { businessDate, rowData, derived: computeDayDerived(rowData) };
  });
  const receiptTotals = summarizeReceiptAmounts(
    receipts
      .filter((r) => r.amountYen !== null)
      .map((r) => ({ businessDate: r.businessDate, amount: String(r.amountYen) })),
  );
  return {
    staffId: `id-${name}`,
    staffName: name,
    staffEmail: 'staff@example.com',
    months: [
      {
        month: {
          yearMonth,
          staffId: `id-${name}`,
          staffName: name,
          days,
          totals: computeMonthlyTotals(days),
          receipts: receiptTotals,
        },
        receipts,
      },
    ],
  };
}

/** 代表的な日(雪の補正・mtg・所定外・距離の超過・3件の訪問・空の日)。 */
export const SAMPLE_ROWS: Record<string, AttendanceRowData> = {
  '2026-09-01': {
    C: '佐藤様',
    D: '09:00',
    E: '12:00',
    H: '20',
    I: '雪',
    L: '田中様',
    M: '13:00',
    N: '15:00',
    AG: '5.55',
    AI: '3.2',
    AJ: '16.4',
    AO: '雨のため遅延',
  },
  '2026-09-03': { C: '鈴木様', D: '10:00', E: '11:30', X: 'チームmtg', Y: '16:00', Z: '18:00', AN: '1' },
  '2026-09-05': {
    C: '高橋様',
    D: '17:30',
    E: '19:00',
    H: '13',
    I: '雪',
    L: '伊藤様',
    M: '19:30',
    N: '20:00',
    Q: '10',
    R: '晴れ',
    U: '渡辺様',
    V: '20:30',
    W: '21:00',
    AG: '21',
    AH: '30.5',
    AA: '広報業務',
    AB: '08:00',
    AC: '10:30',
  },
};

export const SAMPLE_RECEIPTS: AttendanceExportReceipt[] = [
  {
    businessDate: '2026-09-01',
    time: '10:05',
    customerName: '佐藤様',
    storeName: 'スーパー',
    amountYen: 1200,
    handoffText: '牛乳を買いました',
  },
  {
    businessDate: '2026-09-01',
    time: '11:00',
    customerName: '佐藤様',
    storeName: '薬局',
    amountYen: 800,
    handoffText: '',
  },
  {
    businessDate: '2026-09-05',
    time: '19:10',
    customerName: '',
    storeName: '=HYPERLINK("https://example.com")',
    amountYen: null,
    handoffText: '',
  },
  {
    businessDate: '2026-09-30',
    time: '23:50',
    customerName: '高橋様',
    storeName: 'コンビニ',
    amountYen: 450,
    handoffText: '',
  },
];
