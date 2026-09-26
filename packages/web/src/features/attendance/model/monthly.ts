import type { AttendanceMonth } from '@katahimo/shared';
import { isSlotFilled, SLOT_DEFS, type SlotDef, type SlotValues, toDayRecord } from './dayRecord';

/**
 * 今月のまとめ(GAS版 renderAttendanceMonthly / attendanceMonthlyHasContent_ /
 * openScheduleSlotFromMonthlyIndex_)の、表示に使う値の組み立て。
 */

type MonthDay = AttendanceMonth['days'][number];
type Derived = MonthDay['derived'];

export interface MonthlyDayCard {
  date: string;
  day: string;
  dow: string;
  derived: Derived;
  /** 訪問先・事務作業の名前を「・」でつないだもの */
  names: string;
  overThresholdCount: number;
  /** カードを押したときに開く予定(入っている最初の予定)。無ければ null */
  firstSlot: { def: SlotDef; values: SlotValues } | null;
}

/**
 * 内容のある日か。名前・時刻・備考のどれかが入っている、距離・買い物代行が0より大きい、
 * 働いた時間が0より大きい日だけを出す(天候・計画移動時間だけの日は出さない)。
 */
export function monthDayHasContent(day: MonthDay): boolean {
  const record = toDayRecord(day.rowData);
  const hasText =
    SLOT_DEFS.some(({ key }) => {
      const s = record.slots[key];
      return [s.name, s.start, s.end].some((v) => v.trim() !== '');
    }) || record.detail.remarks.trim() !== '';
  if (hasText) return true;
  const { leg12Km, leg23Km, commuteKm, leavingKm, shoppingCount } = record.detail;
  if ([leg12Km, leg23Km, commuteKm, leavingKm, shoppingCount].some((v) => Number(v) > 0)) return true;
  return day.derived.workedMinutes > 0;
}

export function buildMonthlyDayCards(
  month: AttendanceMonth,
  dowLabel: (ymd: string) => string,
): MonthlyDayCard[] {
  return month.days.filter(monthDayHasContent).map((d) => {
    const record = toDayRecord(d.rowData);
    const names = SLOT_DEFS.map(({ key }) => record.slots[key].name)
      .filter(Boolean)
      .join('・');
    const firstDef = SLOT_DEFS.find(({ key }) => isSlotFilled(record.slots[key]));
    return {
      date: d.businessDate,
      day: String(Number(d.businessDate.slice(8, 10))),
      dow: dowLabel(d.businessDate),
      derived: d.derived,
      names,
      overThresholdCount: Number(d.derived.overThresholdCount || 0),
      firstSlot: firstDef ? { def: firstDef, values: record.slots[firstDef.key] } : null,
    };
  });
}

/** 領収書の日ごとの一覧(日付順)。amount は会社負担を含む合計、companyPaid はうち会社負担 */
export function receiptRows(month: AttendanceMonth): { date: string; amount: number; companyPaid: number }[] {
  return Object.keys(month.receipts.byDay)
    .sort()
    .map((date) => ({
      date,
      amount: Number(month.receipts.byDay[date]),
      companyPaid: Number(month.receipts.companyPaidByDay[date] ?? 0),
    }));
}
