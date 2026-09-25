import { jstBusinessDate } from '../../domain/calendarDate';
import type { TenantRecord } from '../../ports/repositories';
import { syncStaffDayFromCalendar } from './calendarSync';
import { currentTime, type NightlyCalendarSyncDeps } from './deps';

export interface NightlySyncStaffFailure {
  staffId: string;
  error: string;
}

export interface NightlySyncTenantSummary {
  tenantId: string;
  tenantSlug: string;
  date: string;
  staffCount: number;
  succeeded: number;
  failed: number;
  /** 出勤簿の内容が実際に変わったスタッフの数。 */
  changedStaffCount: number;
  appointmentCount: number;
  failures: NightlySyncStaffFailure[];
  /** テナント単位で処理できなかった場合(スタッフ一覧の取得失敗等)の理由。 */
  error?: string;
}

export interface NightlySyncSummary {
  date: string;
  tenants: NightlySyncTenantSummary[];
  succeeded: number;
  failed: number;
}

/**
 * 1テナント分: 在籍中の全スタッフについて、指定日の予定を出勤簿へ反映する。
 * 1スタッフの失敗で他スタッフの処理を止めないよう、スタッフごとに失敗を記録して続行する。
 */
export async function syncDayForAllStaff(
  deps: NightlyCalendarSyncDeps,
  tenant: TenantRecord,
  date: string,
): Promise<NightlySyncTenantSummary> {
  const staffList = await deps.staff.listActive(tenant.id);
  const summary: NightlySyncTenantSummary = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    date,
    staffCount: staffList.length,
    succeeded: 0,
    failed: 0,
    changedStaffCount: 0,
    appointmentCount: 0,
    failures: [],
  };

  for (const staff of staffList) {
    try {
      const result = await syncStaffDayFromCalendar(
        deps,
        tenant.id,
        { staffId: staff.id, staffName: staff.name },
        date,
        null,
      );
      summary.succeeded++;
      summary.appointmentCount += result.appointmentCount;
      if (result.changes.length > 0) summary.changedStaffCount++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed++;
      summary.failures.push({ staffId: staff.id, error: message });
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'ERROR',
        action: 'attendance.nightly_sync.staff_failed',
        targetStaffId: staff.id,
        details: { date, error: message },
      });
    }
  }

  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'INFO',
    action: 'attendance.nightly_sync.done',
    details: {
      date,
      staffCount: summary.staffCount,
      succeeded: summary.succeeded,
      failed: summary.failed,
      changedStaffCount: summary.changedStaffCount,
      appointmentCount: summary.appointmentCount,
    },
  });
  return summary;
}

/**
 * 夜間バッチ(GAS版 autoSyncTodayScheduleForAllStaff、毎日22時台): 利用中の全テナントの
 * 在籍中の全スタッフについて、当日(JST)の予定を出勤簿へ反映する。
 * 各スタッフの反映は冪等なので、途中で失敗して再実行しても二重に書き込まれることはない。
 */
export async function runNightlyCalendarSync(
  deps: NightlyCalendarSyncDeps,
  options: { date?: string } = {},
): Promise<NightlySyncSummary> {
  const date = options.date ?? jstBusinessDate(currentTime(deps));
  const tenants = await deps.tenants.listActive();
  const summaries: NightlySyncTenantSummary[] = [];
  for (const tenant of tenants) {
    try {
      summaries.push(await syncDayForAllStaff(deps, tenant, date));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'ERROR',
        action: 'attendance.nightly_sync.tenant_failed',
        details: { date, error: message },
      });
      summaries.push({
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        date,
        staffCount: 0,
        succeeded: 0,
        failed: 1,
        changedStaffCount: 0,
        appointmentCount: 0,
        failures: [],
        error: message,
      });
    }
  }
  return {
    date,
    tenants: summaries,
    succeeded: summaries.reduce((n, s) => n + s.succeeded, 0),
    failed: summaries.reduce((n, s) => n + s.failed, 0),
  };
}
