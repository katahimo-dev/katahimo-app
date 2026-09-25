import { runOutboxBatch } from '@katahimo/core';
import { getDatabase } from '@katahimo/db';
import { createWorkerContainer } from './container';
import { loadWorkerEnv } from './env';
import { loadDotenv } from './loadDotenv';

// outboxミラー(Sheets/Drive)を実行するワーカー。夜間同期・CSV取込ポーリングは別Phaseで追加する。
// Cloud Run Jobs / 常駐プロセスのどちらでも動くよう、単純なポーリングループにしてある。

loadDotenv();
const env = loadWorkerEnv();
const db = getDatabase();
const container = createWorkerContainer(env, db);

let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});

async function pollOnce(): Promise<void> {
  const tenants = await container.tenants.listAll();
  for (const tenant of tenants) {
    const { processed, failed } = await runOutboxBatch(container, tenant.id, env.OUTBOX_BATCH_SIZE);
    if (processed > 0 || failed > 0) {
      console.log(`[mirror] tenant=${tenant.slug} processed=${processed} failed=${failed}`);
    }
  }
}

async function mainLoop(): Promise<void> {
  console.log(`katahimo worker を起動しました(ポーリング間隔: ${env.OUTBOX_POLL_INTERVAL_MS}ms)`);
  while (!stopping) {
    try {
      await pollOnce();
    } catch (e) {
      console.error('[mirror] ポーリング中にエラーが発生しました', e);
    }
    await new Promise((resolve) => setTimeout(resolve, env.OUTBOX_POLL_INTERVAL_MS));
  }
  console.log('katahimo worker を停止しました');
}

mainLoop();
