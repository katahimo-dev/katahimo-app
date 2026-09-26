import { closeDatabase, createDatabase } from '@katahimo/db';
import { createWorkerContainer } from './container';
import { loadWorkerEnv } from './env';
import { runCsvImportJob } from './jobs/csvImport';
import { scheduleDailyJst } from './jobs/dailySchedule';
import { startHealthServer } from './jobs/healthServer';
import { logJson } from './jobs/log';
import { runMaintenanceJob } from './jobs/maintenance';
import { runNightlyCalendarSyncJob } from './jobs/nightlyCalendarSync';
import { runOutboxPoller } from './jobs/outboxPoller';
import { runRouteNoticeJob } from './jobs/routeNotice';
import { StopSignal } from './jobs/stopSignal';
import { loadDotenv } from './loadDotenv';

// 常駐ワーカー: outbox(ミラー・再設定メール・Web Push)を処理し続ける。
// 夜間ジョブ(翌日の予定のお知らせ・カレンダー反映・顧客CSV取込・保守)は本番では Cloud Scheduler → Cloud Run Jobs で
// entrypoints/*.ts を1回ずつ実行する。WORKER_IN_PROCESS_CRON=true のときだけ、ローカル開発用に
// この常駐プロセスの中でも既定の時刻(JST 19:00 / 22:00 / 03:00 / 04:00)に実行する。
// WORKER_HEALTH_PORT が設定されている(Cloud Run サービス)ときはヘルスチェック用に待ち受ける。

loadDotenv();
const env = loadWorkerEnv();
const db = createDatabase(env.WORKER_DATABASE_URL);
const container = createWorkerContainer(env, db);
const healthServer = env.WORKER_HEALTH_PORT ? startHealthServer(env.WORKER_HEALTH_PORT) : null;
const stopCron: Array<() => void> = [];

// 停止の合図: 待ち時間はすぐに抜け、処理中の1件は終えてから止まる。時間内に終わらなければ強制終了
const stop = new StopSignal().listen((signal) => {
  logJson('INFO', `${signal} を受け取りました。処理中のものを終えてから停止します`);
  for (const cancel of stopCron) cancel();
  healthServer?.close();
  setTimeout(() => {
    logJson('ERROR', '停止が時間内に終わらないため強制終了します');
    process.exit(1);
  }, env.WORKER_SHUTDOWN_TIMEOUT_MS).unref();
});

if (env.WORKER_IN_PROCESS_CRON) {
  stopCron.push(
    scheduleDailyJst(19, 0, async () => {
      await runRouteNoticeJob(container, { stop });
    }),
    scheduleDailyJst(22, 0, async () => {
      await runNightlyCalendarSyncJob(container, { stop });
    }),
    scheduleDailyJst(3, 0, async () => {
      await runCsvImportJob(container);
    }),
    scheduleDailyJst(4, 0, async () => {
      await runMaintenanceJob(container, stop);
    }),
  );
  logJson(
    'INFO',
    'プロセス内の定期実行を有効にしました(予定のお知らせ 19:00 / 夜間反映 22:00 / 顧客CSV取込 03:00 / 保守 04:00 JST)',
  );
}

logJson('INFO', 'katahimo worker を起動しました', {
  workerId: container.workerId,
  pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
  mirrorTenant: container.mirrorTenantSlug,
  webPushEnabled: container.webPush !== null,
});
runOutboxPoller(container, {
  intervalMs: env.OUTBOX_POLL_INTERVAL_MS,
  maxMessages: env.OUTBOX_DRAIN_MAX,
  stop,
})
  .then(async () => {
    await closeDatabase(db).catch(() => undefined);
    logJson('INFO', 'katahimo worker を停止しました');
    process.exit(0);
  })
  .catch((error: unknown) => {
    logJson('ERROR', 'katahimo worker が異常終了しました', { error: String(error) });
    process.exit(1);
  });
