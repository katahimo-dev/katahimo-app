import { createTestContext } from '@katahimo/core/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { WorkerContainer } from '../container';
import { runMaintenanceJob } from './maintenance';
import { runNightlyCalendarSyncJob } from './nightlyCalendarSync';
import { StopSignal } from './stopSignal';

/** テスト用の依存一式(インメモリ)をワーカーの container として使う。 */
function containerOf(ctx: ReturnType<typeof createTestContext>): WorkerContainer {
  return {
    ...ctx.deps,
    platform: {
      ensureAppLogPartitions: async () => 0,
      dropAppLogPartitions: async () => 0,
      purgeRateLimitBuckets: async () => 0,
    },
    appLogRetentionMonths: 13,
  } as unknown as WorkerContainer;
}

describe('停止の合図で途中で止めたジョブは失敗として終わる', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  it('夜間のカレンダー反映: 全てのスタッフを処理する前に止めたら ok = false(interrupted)', async () => {
    const ctx = createTestContext();
    await ctx.addStaff('山田 太郎', 'taro@example.com');
    const stop = new StopSignal();
    stop.stop();
    const result = await runNightlyCalendarSyncJob(containerOf(ctx), { stop });
    expect(result.ok).toBe(false);
    expect(result.summary.interrupted).toBe(true);
    // 止めなければ成功
    const finished = await runNightlyCalendarSyncJob(containerOf(ctx), { stop: new StopSignal() });
    expect(finished).toMatchObject({ ok: true, summary: { interrupted: false, succeeded: 1 } });
  });

  it('保守: テナントを処理する前に止めたら ok = false。パーティションの作成の失敗も ok = false(ERROR ログ)', async () => {
    const ctx = createTestContext();
    const stop = new StopSignal();
    stop.stop();
    expect(await runMaintenanceJob(containerOf(ctx), stop)).toEqual({ ok: false });
    expect(await runMaintenanceJob(containerOf(ctx), new StopSignal())).toEqual({ ok: true });

    const failing = containerOf(ctx);
    failing.platform.ensureAppLogPartitions = async () => {
      throw new Error('パーティションを作れません');
    };
    expect(await runMaintenanceJob(failing, new StopSignal())).toEqual({ ok: false });
    expect(ctx.appLog.byAction('maintenance.app_log_partitions.create_failed')).toEqual([
      expect.objectContaining({ level: 'ERROR' }),
    ]);
    // 他の処理(テナントの保存期間の削除)は続ける
    expect(ctx.appLog.byAction('maintenance.retention.done').length).toBeGreaterThan(0);
  });
});
