import { type RouteNoticeSummary, runRouteNoticeJob as runRouteNotice } from '@katahimo/core/usecases';
import type { WorkerContainer } from '../container';
import { logJson } from './log';
import type { StopSignal } from './stopSignal';

/**
 * 翌日の予定のお知らせ(Web Push。GAS版 gas-root-serach の夜間 main() の LINE WORKS DM の置き換え)。既定: 毎日19:00 JST。
 * 全テナントの、購読を持ち明日の予定があるスタッフに、予定の一覧のお知らせを outbox に積む(送るのは outbox ポーラー)。
 * 端末 × スタッフ × 日付で1件なので流し直してよい(積み済みは alreadyQueued に数える)。VAPID の設定が無ければ何もしない。1人でも予定を読めなかった・停止の合図で
 * 途中で止めた場合は失敗扱い(終了コード1)にして Cloud Run Jobs の再試行に乗せる。
 */
export async function runRouteNoticeJob(
  container: WorkerContainer,
  options: { date?: string | undefined; stop?: StopSignal } = {},
): Promise<{ ok: boolean; summary: RouteNoticeSummary | null }> {
  if (!container.webPush) {
    logJson('INFO', 'Web Push(VAPID)が設定されていないため、翌日の予定のお知らせは送りません');
    return { ok: true, summary: null };
  }
  const summary = await runRouteNotice(container, {
    ...(options.date ? { date: options.date } : {}),
    ...(options.stop ? { shouldStop: () => options.stop?.stopped ?? false } : {}),
  });
  const ok = summary.failed === 0 && !summary.interrupted;
  logJson(
    ok ? 'INFO' : 'ERROR',
    summary.interrupted ? '翌日の予定のお知らせを途中で止めました' : '翌日の予定のお知らせを積み終えました',
    {
      queued: summary.queued,
      alreadyQueued: summary.alreadyQueued,
      failed: summary.failed,
      interrupted: summary.interrupted,
      // 予定を読めないため飛ばしたテナント(gas_bridge は GAS_BRIDGE_TENANT だけを処理する)
      skippedTenants: summary.skippedTenants.map((t) => t.tenantSlug),
      tenants: summary.tenants.map((t) => ({
        tenant: t.tenantSlug,
        date: t.date,
        targetCount: t.targetCount,
        queued: t.queued,
        alreadyQueued: t.alreadyQueued,
        noEvents: t.noEvents,
        failed: t.failed,
        error: t.error,
      })),
    },
  );
  return { ok, summary };
}
