import { errorLogDetails, errorMessageOf, zonedBusinessDate } from '../../domain';
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
  /** 停止の合図で、全てのスタッフを処理する前に止めた。 */
  interrupted: boolean;
  /** テナント単位で処理できなかった場合(スタッフ一覧の取得失敗等)の理由。 */
  error?: string;
}

export interface NightlySyncSummary {
  tenants: NightlySyncTenantSummary[];
  /** 予定を読めないため飛ばしたテナント(NightlyCalendarSyncDeps.scheduleTenantSlug)。 */
  skippedTenants: { tenantId: string; tenantSlug: string }[];
  succeeded: number;
  failed: number;
  /** 停止の合図で、全てのテナント・スタッフを処理する前に止めた(ジョブは失敗として終わる)。 */
  interrupted: boolean;
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
    interrupted: false,
  };
  for (const staff of staffList) {
    if (shouldStop()) {
      summary.interrupted = true;
      break;
    }
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
      summary.failed++;
      // 文はジョブの出力(プロセスのログ)にだけ。操作ログは種類・理由コードだけ
      summary.failures.push({ staffId: staff.id, error: errorMessageOf(error) });
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'ERROR',
        action: 'attendance.nightly_sync.staff_failed',
        targetStaffId: staff.id,
        details: { date, ...errorLogDetails(error) },
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
      interrupted: summary.interrupted,
    },
  });
  return summary;
}

/**
 * 夜間バッチ(GAS版 autoSyncTodayScheduleForAllStaff、毎日22時台): 利用中の全テナントについて、テナントの
 * タイムゾーンでの「今日」(または options.date)の予定を、その日に在籍している全スタッフの出勤簿へ反映する。
 * 各スタッフの反映は冪等なので、途中で失敗して再実行しても二重には書かない。停止の合図で途中で止めた場合は
 * interrupted(残りは再実行で反映する)。予定を読めるテナントが決まっていれば(gas_bridge)、他のテナントは飛ばして
 * INFO `attendance.nightly_sync.tenant_skipped`(失敗にしない)。
 */
export async function runNightlyCalendarSync(
  deps: NightlyCalendarSyncDeps,
  options: { date?: string; shouldStop?: () => boolean } = {},
): Promise<NightlySyncSummary> {
  const summaries: NightlySyncTenantSummary[] = [];
  const skippedTenants: NightlySyncSummary['skippedTenants'] = [];
  let interrupted = false;
  for (const tenant of await deps.tenants.listActive()) {
    if (options.shouldStop?.()) {
      interrupted = true;
      break;
    }
    const date = options.date ?? zonedBusinessDate(currentTime(deps), tenant.timezone);
    if (deps.scheduleTenantSlug && tenant.slug !== deps.scheduleTenantSlug) {
      skippedTenants.push({ tenantId: tenant.id, tenantSlug: tenant.slug });
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'INFO',
        action: 'attendance.nightly_sync.tenant_skipped',
        details: { date, reason: 'schedule_provider_other_tenant' },
      });
      continue;
    }
    try {
      summaries.push(await syncDayForAllStaff(deps, tenant, date, options.shouldStop));
    } catch (error) {
      const message = errorMessageOf(error);
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'ERROR',
        action: 'attendance.nightly_sync.tenant_failed',
        details: { date, ...errorLogDetails(error) },
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
        interrupted: false,
        error: message,
      });
    }
  }
  return {
    tenants: summaries,
    skippedTenants,
    succeeded: summaries.reduce((n, s) => n + s.succeeded, 0),
    failed: summaries.reduce((n, s) => n + s.failed, 0),
    interrupted: interrupted || summaries.some((s) => s.interrupted),
  };
}
