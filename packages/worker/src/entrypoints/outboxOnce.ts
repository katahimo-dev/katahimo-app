import { pollOutboxOnce } from '../jobs/outboxPoller';
import { runOneShot } from '../jobs/runOneShot';

// pnpm --filter @katahimo/worker outbox:once
// outboxを1回だけ処理して終わる(動作確認用。常駐させる場合は start)。
runOneShot('outbox-once', async (container, env) => {
  const summary = await pollOutboxOnce(container, env.OUTBOX_BATCH_SIZE);
  return { ok: summary.failed === 0 };
});
