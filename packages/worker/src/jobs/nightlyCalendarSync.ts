import { type NightlySyncSummary, runNightlyCalendarSync } from '@katahimo/core/usecases';
import type { WorkerContainer } from '../container';
import { logJson } from './log';
import { drainOutboxAfterBatch } from './outboxDrain';
import type { StopSignal } from './stopSignal';

/**
 * 夜間のカレンダー → 出勤簿反映(GAS版 autoSyncTodayScheduleForAllStaff)。推奨: 毎日22:00 JST。
 * 全テナントの在籍スタッフの当日分を反映し、最後に積んだ outbox(スプレッドシートへのミラー)をこのジョブの中で送る
 * (drainOutboxAfterBatch。送れなかったものは outbox-drain の見回りが送る)。冪等なので再実行してよい。
 * 1人でも失敗があった・停止の合図で途中で止めた場合は失敗扱い(終了コード1)にして、Cloud Run Jobs の
 * 再試行・アラートに乗せる(反映は冪等なので再試行で残りを反映する)。
 */
export async function runNightlyCalendarSyncJob(
  container: WorkerContainer,
  options: { date?: string | undefined; stop?: StopSignal } = {},
): Promise<{ ok: boolean; summary: NightlySyncSummary }> {
  const summary = await runNightlyCalendarSync(container, {
    ...(options.date ? { date: options.date } : {}),
    ...(options.stop ? { shouldStop: () => options.stop?.stopped ?? false } : {}),
  });
  const ok = summary.failed === 0 && !summary.interrupted;
  if (summary.tenants.some((t) => t.changedStaffCount > 0)) {
    await drainOutboxAfterBatch(container, 'nightly-calendar-sync', options.stop);
  }
  logJson(
    ok ? 'INFO' : 'ERROR',
    summary.interrupted ? '夜間のカレンダー反映を途中で止めました' : '夜間のカレンダー反映が終わりました',
    {
      succeeded: summary.succeeded,
      failed: summary.failed,
      interrupted: summary.interrupted,
      // 予定を読めないため飛ばしたテナント(gas_bridge は GAS_BRIDGE_TENANT だけを処理する)
      skippedTenants: summary.skippedTenants.map((t) => t.tenantSlug),
      tenants: summary.tenants.map((t) => ({
        tenant: t.tenantSlug,
        staffCount: t.staffCount,
        succeeded: t.succeeded,
        failed: t.failed,
        changedStaffCount: t.changedStaffCount,
        error: t.error,
        // 失敗の文はここ(プロセスのログ)にだけ出す。操作ログは例外の種類・理由コードだけ
        failures: t.failures,
      })),
    },
  );
  return { ok, summary };
}
