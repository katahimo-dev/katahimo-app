import { syncStaffBusyBlocksForAllTenants } from '@katahimo/core/usecases';
import type { WorkerContainer } from '../container';
import { logJson } from './log';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * スタッフのGoogleカレンダーの free/busy を staff_busy_blocks に同期する(将来のマッチング用、doc/10_マッチング拡張設計.md)。
 * GAS版に相当する機能は無く、既定ではスケジュール登録していない(必要になったら Cloud Scheduler に登録する)。
 */
export async function runSyncBusyBlocksJob(
  container: WorkerContainer,
  options: { days: number; now?: Date },
): Promise<{ ok: boolean }> {
  const from = options.now ?? new Date();
  const window = { from, to: new Date(from.getTime() + options.days * DAY_MS) };
  const results = await syncStaffBusyBlocksForAllTenants(
    { ...container.busyBlockSync(), tenants: container.tenants },
    window,
  );
  const summary = [...results].map(([tenantId, result]) =>
    result instanceof Error
      ? { tenantId, error: result.message }
      : { tenantId, syncedStaffCount: result.syncedStaffCount, failureCount: result.failures.length },
  );
  const ok = summary.every((s) => !('error' in s) && s.failureCount === 0);
  logJson(ok ? 'INFO' : 'ERROR', 'free/busy の同期が終わりました', {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    tenants: summary,
  });
  return { ok };
}
