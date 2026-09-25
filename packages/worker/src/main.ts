import { getDatabase } from '@katahimo/db';
import { createWorkerContainer } from './container';
import { loadWorkerEnv } from './env';
import { runCsvImportJob } from './jobs/csvImport';
import { scheduleDailyJst } from './jobs/dailySchedule';
import { startHealthServer } from './jobs/healthServer';
import { logJson } from './jobs/log';
import { runNightlyCalendarSyncJob } from './jobs/nightlyCalendarSync';
import { runOutboxPoller } from './jobs/outboxPoller';
import { loadDotenv } from './loadDotenv';

// 常駐ワーカー: outboxミラー(Sheets/Drive)のポーリングを続ける。
// 夜間ジョブ(カレンダー反映・顧客CSV取込)は本番では Cloud Scheduler → Cloud Run Jobs で
// entrypoints/*.ts を1回ずつ実行する。WORKER_IN_PROCESS_CRON=true のときだけ、ローカル開発用に
// この常駐プロセスの中でも同じ時刻(JST 22:00 / 03:00)に実行する。
// WORKER_HEALTH_PORT が設定されている(Cloud Run サービス)ときはヘルスチェック用に待ち受ける。

loadDotenv();
const env = loadWorkerEnv();
const container = createWorkerContainer(env, getDatabase());

const healthServer = env.WORKER_HEALTH_PORT ? startHealthServer(env.WORKER_HEALTH_PORT) : null;

let stopping = false;
const stopCron: Array<() => void> = [];
const stop = (): void => {
  stopping = true;
  for (const cancel of stopCron) cancel();
  healthServer?.close();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

if (env.WORKER_IN_PROCESS_CRON) {
  stopCron.push(
    scheduleDailyJst(22, 0, async () => {
      await runNightlyCalendarSyncJob(container);
    }),
    scheduleDailyJst(3, 0, async () => {
      await runCsvImportJob(container);
    }),
  );
  logJson('INFO', 'プロセス内の定期実行を有効にしました(夜間反映 22:00 / 顧客CSV取込 03:00 JST)');
}

logJson('INFO', 'katahimo worker を起動しました', { pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS });
runOutboxPoller(container, {
  intervalMs: env.OUTBOX_POLL_INTERVAL_MS,
  batchSize: env.OUTBOX_BATCH_SIZE,
  shouldStop: () => stopping,
}).then(() => {
  logJson('INFO', 'katahimo worker を停止しました');
  process.exit(0);
});
