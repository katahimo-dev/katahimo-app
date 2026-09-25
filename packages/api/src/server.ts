import { serve } from '@hono/node-server';
import { getDatabase } from '@katahimo/db';
import { createApp } from './app';
import { loadEnv } from './env';
import { loadDotenv } from './loadDotenv';

loadDotenv();
const env = loadEnv();
const db = getDatabase();
const app = createApp({ env, db });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`katahimo API を起動しました: http://localhost:${info.port}`);
});

// Cloud Run はインスタンス停止の前に SIGTERM を送り、約10秒待つ。処理中のリクエストを終えてから終了する。
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
