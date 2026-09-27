import { closeDatabase, createDatabase } from '@katahimo/db';
import { createWorkerContainer } from './container';
import { loadWorkerEnv } from './env';
import { logJson } from './jobs/log';
import { pollOutboxLocally } from './jobs/outboxDrain';
import { StopSignal } from './jobs/stopSignal';
import { loadDotenv } from './loadDotenv';

// pnpm worker: ローカル開発専用の outbox の見回り(ミラー・再設定メール・Web Push を OUTBOX_POLL_INTERVAL_MS ごとに処理する)。
// ローカルの API は OUTBOX_DRAIN_JOB が無いため outbox-drain の起動を頼まない。代わりにこれを動かしておくか、
// 必要なときに pnpm outbox:once を流す。本番は Cloud Run Jobs の outbox-drain(dist/outbox-once.js)で、
// このファイルは本番のイメージに入れない(tsup.config.ts)。夜間ジョブは pnpm job:* で1回ずつ流す。

loadDotenv();
const env = loadWorkerEnv();
if (env.NODE_ENV === 'production') {
  logJson(
    'ERROR',
    'pnpm worker はローカル開発専用です。本番の outbox は Cloud Run Jobs の outbox-drain が処理します',
  );
  process.exit(1);
}
const db = createDatabase(env.WORKER_DATABASE_URL);
const container = createWorkerContainer(env, db);

// 停止の合図: 待ち時間はすぐに抜け、処理中の1件は終えてから止まる。時間内に終わらなければ強制終了
const stop = new StopSignal().listen((signal) => {
  logJson('INFO', `${signal} を受け取りました。処理中のものを終えてから停止します`);
  setTimeout(() => {
    logJson('ERROR', '停止が時間内に終わらないため強制終了します');
    process.exit(1);
  }, env.WORKER_SHUTDOWN_TIMEOUT_MS).unref();
});

logJson('INFO', 'outbox の見回り(ローカル開発)を始めました', {
  workerId: container.workerId,
  pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
  mirrorTenant: container.mirrorTenantSlug,
  webPushEnabled: container.webPush !== null,
});
pollOutboxLocally(container, { intervalMs: env.OUTBOX_POLL_INTERVAL_MS, stop })
  .then(async () => {
    await closeDatabase(db).catch(() => undefined);
    logJson('INFO', 'outbox の見回りを止めました');
    process.exit(0);
  })
  .catch((error: unknown) => {
    logJson('ERROR', 'outbox の見回りが異常終了しました', { error: String(error) });
    process.exit(1);
  });
