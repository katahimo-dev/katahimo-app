import { drainOutboxOnce } from '../jobs/outboxPoller';
import { runOneShot } from '../jobs/runOneShot';

// pnpm --filter @katahimo/worker outbox:once
// outbox を空になるまで(OUTBOX_DRAIN_MAX 件まで)処理して終わる(動作確認用。常駐させる場合は start)。
runOneShot('outbox-once', async (container, env, stop) => {
  const result = await drainOutboxOnce(container, { maxMessages: env.OUTBOX_DRAIN_MAX, stop });
  return { ok: result.failed === 0 };
});
