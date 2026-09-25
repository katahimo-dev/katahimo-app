import { runMaintenance } from '@katahimo/core/usecases';
import type { WorkerContainer } from '../container';
import { logJson } from './log';
import type { StopSignal } from './stopSignal';

/**
 * 保守(毎日1回。推奨 04:00 JST): 操作ログの月のパーティションの作成・削除、保存期間を過ぎた行・
 * どこからも参照されないファイルの削除(packages/core/src/usecases/maintenance.ts)。
 */
export async function runMaintenanceJob(
  container: WorkerContainer,
  stop?: StopSignal,
): Promise<{ ok: boolean }> {
  const summary = await runMaintenance({
    ...container,
    ...(stop ? { shouldStop: () => stop.stopped } : {}),
  });
  const failed = summary.tenants.filter((t) => t.error);
  logJson(failed.length > 0 ? 'ERROR' : 'INFO', '保守ジョブが終わりました', { ...summary });
  return { ok: failed.length === 0 };
}
