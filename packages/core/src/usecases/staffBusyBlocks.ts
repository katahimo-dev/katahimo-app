import { jstToday } from '../domain/schedule/jstDate';
import type { AppLogPort } from '../ports/appLog';
import type { GoogleCalendarPort, InstantRange } from '../ports/googleCalendar';
import type { TenantRepositoryPort } from '../ports/repositories';
import type { StaffRouteProfileRepositoryPort } from '../ports/scheduleDirectory';
import type { StaffBusyBlockStorePort } from '../ports/staffBusyBlocks';

export interface StaffBusyBlockSyncDeps {
  calendar: GoogleCalendarPort;
  staffRouteProfiles: StaffRouteProfileRepositoryPort;
  busyBlocks: StaffBusyBlockStorePort;
  appLog: AppLogPort;
}

export interface StaffBusyBlockSyncResult {
  syncedStaffCount: number;
  failures: Array<{ staffId: string; message: string }>;
}

/** Google Calendar freeBusy の1リクエストあたりのカレンダー数上限。 */
const FREE_BUSY_BATCH_SIZE = 50;

/**
 * calendar_id を持つ在籍スタッフの free/busy を取得し、window 内の staff_busy_blocks
 * (source='google_calendar')を置き換える。将来のマッチングアプリ用(doc/10)。
 * 予定のタイトル・場所は取得も保存もしない(free/busyだけで足り、顧客名等を複製しないため)。
 * 1人の失敗(カレンダー未共有等)で他のスタッフの同期は止めない。
 */
export async function syncStaffBusyBlocks(
  deps: StaffBusyBlockSyncDeps,
  tenantId: string,
  window: InstantRange,
  today: string = jstToday(),
): Promise<StaffBusyBlockSyncResult> {
  const staff = (await deps.staffRouteProfiles.listByTenant(tenantId)).filter(
    (s): s is typeof s & { calendarId: string } =>
      !!s.calendarId && (!s.retirementDate || s.retirementDate > today),
  );

  const result: StaffBusyBlockSyncResult = { syncedStaffCount: 0, failures: [] };
  for (let i = 0; i < staff.length; i += FREE_BUSY_BATCH_SIZE) {
    const batch = staff.slice(i, i + FREE_BUSY_BATCH_SIZE);
    const busyByCalendar = await deps.calendar.freeBusy(
      batch.map((s) => s.calendarId),
      window,
    );
    for (const member of batch) {
      const busy = busyByCalendar.get(member.calendarId);
      if (!busy || busy.error) {
        result.failures.push({ staffId: member.id, message: busy?.error ?? 'free/busyの結果がありません' });
        continue;
      }
      await deps.busyBlocks.replaceInWindow(
        tenantId,
        member.id,
        'google_calendar',
        window,
        busy.busy.map((b) => ({ period: { start: b.start, end: b.end } })),
      );
      result.syncedStaffCount++;
    }
  }

  await deps.appLog.write({
    tenantId,
    level: result.failures.length > 0 ? 'WARN' : 'INFO',
    action: 'calendar.busy_blocks.sync',
    details: {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      syncedStaffCount: result.syncedStaffCount,
      failures: result.failures,
    },
  });
  return result;
}

/**
 * 全テナント分の syncStaffBusyBlocks(ワーカーから定期実行する想定の入口。スケジューラーへの
 * 登録はまだ行っていない)。1テナントの例外で他テナントを止めない。
 */
export async function syncStaffBusyBlocksForAllTenants(
  deps: StaffBusyBlockSyncDeps & { tenants: TenantRepositoryPort },
  window: InstantRange,
): Promise<Map<string, StaffBusyBlockSyncResult | Error>> {
  const results = new Map<string, StaffBusyBlockSyncResult | Error>();
  for (const tenant of await deps.tenants.listAll()) {
    try {
      results.set(tenant.id, await syncStaffBusyBlocks(deps, tenant.id, window));
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      results.set(tenant.id, error);
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'ERROR',
        action: 'calendar.busy_blocks.sync_error',
        details: { message: error.message },
      });
    }
  }
  return results;
}
