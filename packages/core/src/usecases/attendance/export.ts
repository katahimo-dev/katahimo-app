import {
  firstDayOfMonth,
  fiscalYearMonths,
  forbidden,
  formatMinutesToTime,
  invalid,
  isAdminRole,
  minutesSinceZonedMidnight,
  notFound,
  zonedBusinessDate,
} from '../../domain';
import type { ReceiptRow } from '../../ports/records';
import type { TenantRepositories } from '../../ports/unitOfWork';
import type { Actor } from '../requestMeta';
import { type AttendanceTarget, loadAttendanceTarget, writeActorLog } from './access';
import type { AttendanceDeps } from './deps';
import { type AttendanceMonthView, assertYearMonth, loadAttendanceMonth } from './month';

/** 一度に書き出せるスタッフの数(全員分の書き出しの上限。100人で .xlsx は約2MB・作るのに約3秒・メモリは約200MB 増える)。 */
export const MAX_ATTENDANCE_EXPORT_STAFF = 100;

/** 書き出す領収書の明細1件(取消済みの領収書は書き出さない)。 */
export interface AttendanceExportReceipt {
  /** 領収書日時のテナントの暦日。 */
  businessDate: string;
  /** 領収書日時のテナントの時刻 'HH:mm'。 */
  time: string;
  customerName: string;
  storeName: string;
  /** 金額(円)。読み取れず入力も無い領収書は null(合計に入れない。今月のまとめと同じ)。 */
  amountYen: number | null;
  /** 会社負担(お客様に請求しない)。 */
  companyPaid: boolean;
  /** 申し送り(まとめて登録した領収書の、その月の最初の1件にだけ付ける)。 */
  handoffText: string;
}

/** 書き出す1か月分(今月のまとめと同じ値 + 領収書の明細)。 */
export interface AttendanceExportMonth {
  month: AttendanceMonthView;
  receipts: AttendanceExportReceipt[];
}

/** 書き出す1人分。 */
export interface AttendanceExportStaff {
  staffId: string;
  staffName: string;
  /** ログイン用メール(出勤簿の「ID」の欄。GAS版のスタッフ台帳のログインIDと同じ)。 */
  staffEmail: string;
  months: AttendanceExportMonth[];
}

export type AttendanceExportPeriod =
  | { kind: 'month'; yearMonth: string }
  | { kind: 'fiscal_year'; fiscalYear: number };

function monthsOf(period: AttendanceExportPeriod): string[] {
  if (period.kind === 'month') {
    assertYearMonth(period.yearMonth);
    return [period.yearMonth];
  }
  if (!Number.isInteger(period.fiscalYear) || period.fiscalYear < 2000 || period.fiscalYear > 2100) {
    throw invalid('年度の指定が不正です。');
  }
  return fiscalYearMonths(period.fiscalYear);
}

/** 領収書の行 → 明細(お客様の名前は登録したお客様の表示名、無ければ手入力の名前)。 */
async function toExportReceipts(
  r: TenantRepositories,
  rows: ReceiptRow[],
  timeZone: string,
  customerNames: Map<string, string>,
): Promise<AttendanceExportReceipt[]> {
  const seenUploads = new Set<string>();
  const result: AttendanceExportReceipt[] = [];
  for (const row of rows) {
    let customerName = row.customerNameText ?? '';
    if (row.customerId) {
      let name = customerNames.get(row.customerId);
      if (name === undefined) {
        name = (await r.customers.findById(row.customerId))?.displayName ?? '';
        customerNames.set(row.customerId, name);
      }
      customerName = name || customerName;
    }
    let handoffText = '';
    if (!seenUploads.has(row.uploadId)) {
      seenUploads.add(row.uploadId);
      handoffText = (await r.receipts.findUpload(row.uploadId))?.handoffText ?? '';
    }
    const businessDate = zonedBusinessDate(row.receiptedAt, timeZone);
    result.push({
      businessDate,
      time: formatMinutesToTime(minutesSinceZonedMidnight(row.receiptedAt, businessDate, timeZone)),
      customerName,
      storeName: row.storeName ?? '',
      amountYen: row.amountYen,
      companyPaid: row.companyPaid,
      handoffText,
    });
  }
  return result;
}

async function loadExportStaff(
  r: TenantRepositories,
  target: AttendanceTarget,
  staffEmail: string,
  timeZone: string,
  months: string[],
  customerNames: Map<string, string>,
): Promise<AttendanceExportStaff> {
  const exported: AttendanceExportMonth[] = [];
  for (const yearMonth of months) {
    const { view, receipts } = await loadAttendanceMonth(r, target, timeZone, yearMonth);
    exported.push({ month: view, receipts: await toExportReceipts(r, receipts, timeZone, customerNames) });
  }
  return { staffId: target.staffId, staffName: target.staffName, staffEmail, months: exported };
}

/**
 * 1人分の出勤簿の書き出し(1か月、または年度の12か月)。一般スタッフは本人だけ、管理者・コーディネーターは
 * 他のスタッフも(対象の決め方は今月のまとめと同じ)。書き出しは毎回 INFO `attendance.export.downloaded` を残す。
 */
export async function exportAttendance(
  deps: AttendanceDeps,
  actor: Actor,
  targetStaffId: string,
  period: AttendanceExportPeriod,
): Promise<AttendanceExportStaff> {
  const months = monthsOf(period);
  const exported = await deps.uow.run(actor.tenantId, async (r) => {
    const target = await loadAttendanceTarget(r, actor, targetStaffId);
    const staff = await r.staff.findById(target.staffId);
    const timeZone = (await r.tenant()).timezone;
    return loadExportStaff(r, target, staff?.email ?? '', timeZone, months, new Map());
  });
  await writeActorLog(deps.appLog, actor, exported, {
    level: 'INFO',
    action: 'attendance.export.downloaded',
    details:
      period.kind === 'month'
        ? { period: 'month', yearMonth: period.yearMonth }
        : { period: 'fiscal_year', fiscalYear: period.fiscalYear },
  });
  return exported;
}

/**
 * 管理者だけ: その月に在籍している全員(月の初日に退職日を迎えていないスタッフ)の出勤簿の書き出し(1つのファイルに
 * 1人1シート)。GAS版の個別出勤簿のファイルを月末にまとめて集めていた作業の置き換え。
 * SECURITY `attendance.export_all.downloaded`(人数)。
 */
export async function exportAllStaffAttendance(
  deps: AttendanceDeps,
  actor: Actor,
  yearMonth: string,
): Promise<AttendanceExportStaff[]> {
  if (!isAdminRole(actor.role)) throw forbidden('全員分の出勤簿を書き出せるのは管理者だけです。');
  assertYearMonth(yearMonth);
  const exported = await deps.uow.run(actor.tenantId, async (r) => {
    const staffList = await r.staff.listActiveOn(firstDayOfMonth(yearMonth));
    if (staffList.length === 0) throw notFound('この月に在籍しているスタッフがいません。');
    if (staffList.length > MAX_ATTENDANCE_EXPORT_STAFF) {
      throw invalid(`一度に書き出せるのは${MAX_ATTENDANCE_EXPORT_STAFF}人までです。`);
    }
    const timeZone = (await r.tenant()).timezone;
    const customerNames = new Map<string, string>();
    const result: AttendanceExportStaff[] = [];
    for (const staff of staffList) {
      const target = {
        staffId: staff.id,
        staffName: staff.displayName,
        isOtherStaff: staff.id !== actor.staffId,
      };
      result.push(await loadExportStaff(r, target, staff.email, timeZone, [yearMonth], customerNames));
    }
    return result;
  });
  // 全員分(全スタッフの訪問先・時刻・領収書)を1度に持ち出すため、操作ログの CSV のダウンロードと同じく SECURITY
  await writeActorLog(deps.appLog, actor, null, {
    level: 'SECURITY',
    action: 'attendance.export_all.downloaded',
    details: { yearMonth, staffCount: exported.length },
  });
  return exported;
}
