import {
  type AttendanceDayDerived,
  type AttendanceMonthlyTotals,
  type AttendanceRowData,
  computeDayDerived,
  computeMonthlyTotals,
  type ReceiptAmountEntry,
  type ReceiptTotals,
  summarizeReceiptAmounts,
} from '../../domain/attendance';
import { datesOfMonth, isValidYearMonth, jstBusinessDate } from '../../domain/calendarDate';
import {
  type AttendanceActor,
  type AttendanceTarget,
  loadAttendanceTarget,
  logCrossStaffRead,
  writeActorLog,
} from './access';
import type { AttendanceMonthDeps } from './deps';
import { AttendanceError } from './errors';
import { readRowData } from './records';

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

export async function getAttendanceMonth(
  deps: AttendanceMonthDeps,
  actor: AttendanceActor,
  targetStaffId: string,
  yearMonth: string,
): Promise<AttendanceMonthView> {
  if (!isValidYearMonth(yearMonth)) {
    throw new AttendanceError('invalid_request', '年月の指定が不正です(YYYY-MM形式で指定してください)。');
  }
  const target = await loadAttendanceTarget(deps, actor, targetStaffId);

  const records = await deps.attendanceDays.listByStaffAndMonth(actor.tenantId, target.staffId, yearMonth);
  const rowDataByDate = new Map<string, AttendanceRowData>();
  for (const record of records) {
    rowDataByDate.set(record.businessDate, await readRowData(deps, actor.tenantId, record));
  }

  const days = datesOfMonth(yearMonth).map((businessDate) => {
    const rowData = rowDataByDate.get(businessDate) ?? {};
    return { businessDate, rowData, derived: computeDayDerived(rowData) };
  });

  const receipts = await summarizeMonthReceipts(deps, actor, target, yearMonth);
  await logCrossStaffRead(deps, actor, target, 'attendance.month.view', { yearMonth });

  return {
    yearMonth,
    staffId: target.staffId,
    staffName: target.staffName,
    days,
    totals: computeMonthlyTotals(days),
    receipts,
  };
}

/**
 * 領収書の金額を日別・月合計で集計する。参考表示のため、復号できない領収書は集計から外すだけで
 * 月次まとめ自体は失敗させない(GAS版も失敗時は空集計で返していた)。
 */
async function summarizeMonthReceipts(
  deps: AttendanceMonthDeps,
  actor: AttendanceActor,
  target: AttendanceTarget,
  yearMonth: string,
): Promise<ReceiptTotals> {
  const receipts = await deps.receipts.listByStaffAndMonth(actor.tenantId, target.staffId, yearMonth);
  const entries: ReceiptAmountEntry[] = [];
  let skipped = 0;
  for (const receipt of receipts) {
    if (!receipt.amount) continue;
    try {
      entries.push({
        businessDate: jstBusinessDate(receipt.receiptTimestamp),
        amount: await deps.crypto.decrypt(actor.tenantId, receipt.amount),
      });
    } catch {
      skipped++;
    }
  }
  if (skipped > 0) {
    await writeActorLog(deps, actor, target, {
      level: 'WARN',
      action: 'attendance.month.receipt_decrypt_failed',
      details: { yearMonth, skipped },
    });
  }
  return summarizeReceiptAmounts(entries);
}
