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
import type { ReceiptRow } from '../../ports/records';
import type { TenantRepositories } from '../../ports/unitOfWork';
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
 * 月の出勤簿(全日)・合計・領収書の日別/月合計(うち会社負担)。領収書の金額は整数(円)の列をそのまま合計し、
 * 取消済みの領収書は入れない。日の境界はテナントのタイムゾーン。
 */
export async function getAttendanceMonth(
  deps: AttendanceDeps,
  actor: Actor,
  targetStaffId: string,
  yearMonth: string,
): Promise<AttendanceMonthView> {
  assertYearMonth(yearMonth);
  const { target, view } = await deps.uow.run(actor.tenantId, async (r) => {
    const target = await loadAttendanceTarget(r, actor, targetStaffId);
    const timeZone = (await r.tenant()).timezone;
    const { view } = await loadAttendanceMonth(r, target, timeZone, yearMonth);
    return { target, view };
  });
  await logCrossStaffRead(deps.appLog, actor, target, 'attendance.month.view', { yearMonth });
  return view;
}

export function assertYearMonth(yearMonth: string): void {
  if (!isValidYearMonth(yearMonth)) throw invalid('年月の指定が不正です(YYYY-MM形式で指定してください)。');
}

/**
 * 1人・1か月分の出勤簿(全日)・合計・領収書を読む(UoW の中で呼ぶ)。今月のまとめと出勤簿の書き出しが共有する
 * (どちらも同じ値になるように)。receipts は月の取消していない領収書の行(書き出しの明細用)。
 */
export async function loadAttendanceMonth(
  r: TenantRepositories,
  target: { staffId: string; staffName: string },
  timeZone: string,
  yearMonth: string,
): Promise<{ view: AttendanceMonthView; receipts: ReceiptRow[] }> {
  const from = firstDayOfMonth(yearMonth);
  const to = lastDayOfMonth(yearMonth);
  const records = await r.attendance.loadRange(target.staffId, from, to);
  const rowDataByDate = new Map<string, AttendanceRowData>();
  for (const rows of records) {
    const sheet = toSheetDay(timeZone, rows);
    rowDataByDate.set(rows.businessDate, compactRowData(projectDay(sheet).rowData));
  }
  const days = datesOfMonth(yearMonth).map((businessDate) => {
    const rowData = rowDataByDate.get(businessDate) ?? {};
    return { businessDate, rowData, derived: computeDayDerived(rowData) };
  });
  // 取消済みの領収書は入れない(合計・明細とも)
  const receipts = await r.receipts.listActiveByStaffAndPeriod(
    target.staffId,
    zonedDayRange(from, timeZone).from,
    zonedDayRange(to, timeZone).to,
  );
  const receiptTotals = summarizeReceiptAmounts(
    receipts.flatMap((rc) =>
      rc.amountYen === null
        ? []
        : [
            {
              businessDate: zonedBusinessDate(rc.receiptedAt, timeZone),
              amountYen: rc.amountYen,
              companyPaid: rc.companyPaid,
            },
          ],
    ),
  );
  return {
    view: {
      yearMonth,
      staffId: target.staffId,
      staffName: target.staffName,
      days,
      totals: computeMonthlyTotals(days),
      receipts: receiptTotals,
    },
    receipts,
  };
}
