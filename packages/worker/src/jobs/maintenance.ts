import { maintenanceSucceeded, runMaintenance } from '@katahimo/core/usecases';
import type { WorkerContainer } from '../container';
import { logJson } from './log';
import type { StopSignal } from './stopSignal';

/**
 * 保守(毎日1回。推奨 04:00 JST): 操作ログの月のパーティションの作成・削除、保存期間を過ぎた行・
 * どこからも参照されないファイルの削除(packages/core/src/usecases/maintenance.ts)。失敗があった・停止の合図で
 * 途中で止めた場合は ok = false(終了コード1。Cloud Run Jobs の失敗として監視・再試行に乗る)。
 */
export async function runMaintenanceJob(
  container: WorkerContainer,
  stop?: StopSignal,
): Promise<{ ok: boolean }> {
  const summary = await runMaintenance({
    ...container,
    ...(stop ? { shouldStop: () => stop.stopped } : {}),
  });
  const ok = maintenanceSucceeded(summary);
  logJson(
    ok ? 'INFO' : 'ERROR',
    summary.interrupted ? '保守ジョブを途中で止めました' : '保守ジョブが終わりました',
    {
      ...summary,
    },
  );
  return { ok };
}
