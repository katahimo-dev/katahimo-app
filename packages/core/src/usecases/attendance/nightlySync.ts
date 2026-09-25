import { zonedBusinessDate } from '../../domain';
import type { TenantRecord } from '../../ports/tenants';
import { currentTime } from '../requestMeta';
import { syncStaffDayFromCalendar } from './calendarSync';
import type { NightlyCalendarSyncDeps } from './deps';

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
  tenants: NightlySyncTenantSummary[];
  succeeded: number;
  failed: number;
}

/**
 * 1テナント分: date の時点で在籍している全スタッフについて、date の予定を出勤簿へ反映する。
 * 1スタッフの失敗で他のスタッフを止めないよう、スタッフごとに失敗を記録して続ける。shouldStop が true に
 * なったら(ワーカーの停止)次のスタッフに進まない。
 */
export async function syncDayForAllStaff(
  deps: NightlyCalendarSyncDeps,
  tenant: TenantRecord,
  date: string,
  shouldStop: () => boolean = () => false,
): Promise<NightlySyncTenantSummary> {
  const staffList = await deps.uow.run(tenant.id, (r) => r.staff.listActiveOn(date));
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
    if (shouldStop()) break;
    try {
      const result = await syncStaffDayFromCalendar(
        deps,
        { tenantId: tenant.id, staffId: null },
        { staffId: staff.id, staffName: staff.displayName },
        date,
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
 * 夜間バッチ(GAS版 autoSyncTodayScheduleForAllStaff、毎日22時台): 利用中の全テナントについて、テナントの
 * タイムゾーンでの「今日」(または options.date)の予定を、その日に在籍している全スタッフの出勤簿へ反映する。
 * 各スタッフの反映は冪等なので、途中で失敗して再実行しても二重には書かない。
 */
export async function runNightlyCalendarSync(
  deps: NightlyCalendarSyncDeps,
  options: { date?: string; shouldStop?: () => boolean } = {},
): Promise<NightlySyncSummary> {
  const summaries: NightlySyncTenantSummary[] = [];
  for (const tenant of await deps.tenants.listActive()) {
    if (options.shouldStop?.()) break;
    const date = options.date ?? zonedBusinessDate(currentTime(deps), tenant.timezone);
    try {
      summaries.push(await syncDayForAllStaff(deps, tenant, date, options.shouldStop));
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
    tenants: summaries,
    succeeded: summaries.reduce((n, s) => n + s.succeeded, 0),
    failed: summaries.reduce((n, s) => n + s.failed, 0),
  };
}
