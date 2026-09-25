import { serve } from '@hono/node-server';
import { getDatabase } from '@katahimo/db';
import { createApp } from './app';
import { loadEnv } from './env';
import { loadDotenv } from './loadDotenv';

loadDotenv();
const env = loadEnv();
const db = getDatabase();
const app = createApp({ env, db });

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`katahimo API を起動しました: http://localhost:${info.port}`);
});
