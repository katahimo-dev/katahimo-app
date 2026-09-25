import {
  type AttendanceDayDerived,
  type AttendanceMonthlyTotals,
  type AttendanceRowData,
  compactRowData,
  computeDayDerived,
  computeMonthlyTotals,
  datesOfMonth,
  firstDayOfMonth,
  invalid,
  isValidYearMonth,
  lastDayOfMonth,
  projectDay,
  type ReceiptTotals,
  summarizeReceiptAmounts,
  zonedBusinessDate,
  zonedDayRange,
} from '../../domain';
import type { Actor } from '../requestMeta';
import { loadAttendanceTarget, logCrossStaffRead } from './access';
import type { AttendanceDeps } from './deps';
import { toSheetDay } from './records';

export interface AttendanceMonthDayView {
  businessDate: string;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
}

/** 月次まとめ(GAS版 getAttendanceMonth)。days は月の全日分(記録の無い日は空)。 */
export interface AttendanceMonthView {
  yearMonth: string;
  staffId: string;
  staffName: string;
  days: AttendanceMonthDayView[];
  totals: AttendanceMonthlyTotals;
  receipts: ReceiptTotals;
}

/**
 * 月の出勤簿(全日)・合計・領収書の日別/月合計。領収書の金額は平文の整数(円)のため復号しない。日の境界は
 * テナントのタイムゾーン。
 */
export async function getAttendanceMonth(
  deps: AttendanceDeps,
  actor: Actor,
  targetStaffId: string,
  yearMonth: string,
): Promise<AttendanceMonthView> {
  if (!isValidYearMonth(yearMonth)) throw invalid('年月の指定が不正です(YYYY-MM形式で指定してください)。');
  const from = firstDayOfMonth(yearMonth);
  const to = lastDayOfMonth(yearMonth);
  const { target, view } = await deps.uow.run(actor.tenantId, async (r) => {
    const target = await loadAttendanceTarget(r, actor, targetStaffId);
    const timeZone = (await r.tenant()).timezone;
    const records = await r.attendance.loadRange(target.staffId, from, to);
    const rowDataByDate = new Map<string, AttendanceRowData>();
    for (const rows of records) {
      const sheet = await toSheetDay(deps.crypto, r.tenantId, timeZone, rows);
      rowDataByDate.set(rows.businessDate, compactRowData(projectDay(sheet).rowData));
    }
    const days = datesOfMonth(yearMonth).map((businessDate) => {
      const rowData = rowDataByDate.get(businessDate) ?? {};
      return { businessDate, rowData, derived: computeDayDerived(rowData) };
    });
    const receipts = await r.receipts.listByStaffAndPeriod(
      target.staffId,
      zonedDayRange(from, timeZone).from,
      zonedDayRange(to, timeZone).to,
    );
    const receiptTotals = summarizeReceiptAmounts(
      receipts
        .filter((rc) => rc.amountYen !== null)
        .map((rc) => ({
          businessDate: zonedBusinessDate(rc.receiptedAt, timeZone),
          amount: String(rc.amountYen),
        })),
    );
    return {
      target,
      view: {
        yearMonth,
        staffId: target.staffId,
        staffName: target.staffName,
        days,
        totals: computeMonthlyTotals(days),
        receipts: receiptTotals,
      },
    };
  });
  await logCrossStaffRead(deps.appLog, actor, target, 'attendance.month.view', { yearMonth });
  return view;
}
