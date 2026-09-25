import { type NightlySyncSummary, runNightlyCalendarSync } from '@katahimo/core';
import type { WorkerContainer } from '../container';
import { logJson } from './log';

/**
 * 夜間のカレンダー → 出勤簿反映(GAS版 autoSyncTodayScheduleForAllStaff)。推奨: 毎日22:00 JST。
 * 全テナントの在籍スタッフの当日分を反映する。冪等なので再実行してよい。
 * 1人でも失敗があれば失敗扱い(終了コード1)にして、Cloud Run Jobs の再試行・アラートに乗せる。
 */
export async function runNightlyCalendarSyncJob(
  container: WorkerContainer,
  options: { date?: string } = {},
): Promise<{ ok: boolean; summary: NightlySyncSummary }> {
  const summary = await runNightlyCalendarSync(container, options);
  logJson(summary.failed > 0 ? 'ERROR' : 'INFO', '夜間のカレンダー反映が終わりました', {
    date: summary.date,
    succeeded: summary.succeeded,
    failed: summary.failed,
    tenants: summary.tenants.map((t) => ({
      tenant: t.tenantSlug,
      staffCount: t.staffCount,
      succeeded: t.succeeded,
      failed: t.failed,
      changedStaffCount: t.changedStaffCount,
      error: t.error,
    })),
  });
  return { ok: summary.failed === 0, summary };
}
