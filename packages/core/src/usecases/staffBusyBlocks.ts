import { isStaffCalendarAllowed, newId, zonedBusinessDate } from '../domain';
import type { AppLogPort } from '../ports/appLog';
import type { CalendarBusyResult, GoogleCalendarPort, InstantRange } from '../ports/googleCalendar';
import type { TenantDirectoryPort } from '../ports/tenants';
import type { UnitOfWorkPort } from '../ports/unitOfWork';

export interface StaffBusyBlockSyncDeps {
  uow: UnitOfWorkPort;
  calendar: GoogleCalendarPort;
  appLog: AppLogPort;
}

export interface StaffBusyBlockSyncResult {
  syncedStaffCount: number;
  failures: Array<{ staffId: string; message: string }>;
}

/** Google Calendar freeBusy の1リクエストあたりのカレンダー数上限。 */
const FREE_BUSY_BATCH_SIZE = 50;

/**
 * 在籍スタッフのカレンダー(staff_calendars)の free/busy を取得し、window 内の staff_busy_blocks
 * (source='google_calendar')を置き換える(マッチング用、doc/10_マッチング拡張設計.md)。予定のタイトル・場所は取得も保存もしない。
 * 1人の失敗(カレンダー未共有等)で他のスタッフは止めない。同期の結果はカレンダーごとに記録する。
 */
export async function syncStaffBusyBlocks(
  deps: StaffBusyBlockSyncDeps,
  tenantId: string,
  window: InstantRange,
  today?: string,
): Promise<StaffBusyBlockSyncResult> {
  const { calendars, disallowed } = await deps.uow.run(tenantId, async (r) => {
    // 在籍の判定はテナントのタイムゾーンの今日
    const date = today ?? zonedBusinessDate(new Date(), (await r.tenant()).timezone);
    const active = new Set((await r.staff.listActiveOn(date)).map((s) => s.id));
    const settings = await r.calendarSettings();
    const owned = (await r.staffCalendars.listAll()).filter((c) => active.has(c.staffId));
    // 許可の一覧に合わないカレンダー(後から許可を外した等)は読まない(別のテナントのカレンダーを読まないため)
    return {
      calendars: owned.filter((c) => isStaffCalendarAllowed(settings, c.calendarId)),
      disallowed: owned.filter((c) => !isStaffCalendarAllowed(settings, c.calendarId)),
    };
  });
  for (const c of disallowed) {
    await deps.appLog.write({
      tenantId,
      level: 'WARN',
      action: 'calendar.staff_calendar_not_allowed',
      targetStaffId: c.staffId,
      details: { source: 'busy_blocks' },
    });
  }
  const byStaff = new Map<string, typeof calendars>();
  for (const c of calendars) byStaff.set(c.staffId, [...(byStaff.get(c.staffId) ?? []), c]);
  const calendarIds = [...new Set(calendars.map((c) => c.calendarId))];

  const busyByCalendar = new Map<string, CalendarBusyResult>();
  for (let i = 0; i < calendarIds.length; i += FREE_BUSY_BATCH_SIZE) {
    const batch = await deps.calendar.freeBusy(calendarIds.slice(i, i + FREE_BUSY_BATCH_SIZE), window);
    for (const [id, value] of batch) busyByCalendar.set(id, value);
  }

  const result: StaffBusyBlockSyncResult = { syncedStaffCount: 0, failures: [] };
  const now = new Date();
  for (const [staffId, owned] of byStaff) {
    const answers = owned.map((c) => ({ calendar: c, busy: busyByCalendar.get(c.calendarId) }));
    const failed = answers.find((a) => !a.busy || a.busy.error);
    await deps.uow.run(tenantId, async (r) => {
      for (const a of answers) {
        await r.staffCalendars.recordSync(a.calendar.id, {
          at: now,
          error: a.busy?.error ?? (a.busy ? null : 'free/busyの結果がありません'),
        });
      }
      if (failed) return;
      const blocks = answers.flatMap((a) => a.busy?.busy ?? []);
      await r.busyBlocks.replaceInWindow(
        staffId,
        'google_calendar',
        window,
        blocks.map((b) => ({ id: newId(), period: { start: b.start, end: b.end } })),
      );
    });
    if (failed) {
      result.failures.push({ staffId, message: failed.busy?.error ?? 'free/busyの結果がありません' });
      continue;
    }
    result.syncedStaffCount++;
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

/** 全テナント分の syncStaffBusyBlocks(ワーカーのジョブの入口)。1テナントの例外で他テナントを止めない。 */
export async function syncStaffBusyBlocksForAllTenants(
  deps: StaffBusyBlockSyncDeps & { tenants: TenantDirectoryPort },
  window: InstantRange,
): Promise<Map<string, StaffBusyBlockSyncResult | Error>> {
  const results = new Map<string, StaffBusyBlockSyncResult | Error>();
  for (const tenant of await deps.tenants.listActive()) {
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
