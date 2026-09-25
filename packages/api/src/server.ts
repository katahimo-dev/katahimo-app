import { serve } from '@hono/node-server';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';
import { writeStructuredLog } from './http/requestLog';
import { loadDotenv } from './loadDotenv';

loadDotenv();
const env = loadEnv();
const db = createDatabase(env.DATABASE_URL);
const app = createApp({ env, container: createContainer(env, db) });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  writeStructuredLog({
    severity: 'INFO',
    message: `katahimo API を起動しました: http://localhost:${info.port}`,
  });
});

/** Cloud Run は停止の前に SIGTERM を送り、約10秒待つ。それより短い時間で強制的に終える。 */
const SHUTDOWN_TIMEOUT_MS = 8_000;
let shuttingDown = false;

/** 新しい接続の受付を止め、処理中のリクエストを終えてから DB の接続プールを閉じて終了する。 */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  writeStructuredLog({ severity: 'INFO', message: `${signal} を受け取りました。終了します` });
  const forced = setTimeout(() => {
    writeStructuredLog({ severity: 'WARNING', message: '終了処理が時間内に終わらないため強制終了します' });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref();
  server.close(() => {
    closeDatabase(db, 3)
      .catch((e: unknown) =>
        writeStructuredLog({ severity: 'ERROR', message: 'DB の切断に失敗しました', error: String(e) }),
      )
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
