import { drainOutboxOnce } from '../jobs/outboxDrain';
import { runOneShot } from '../jobs/runOneShot';

// 本番: Cloud Run Jobs の outbox-drain(dist/outbox-once.js)。API が outbox に積んだ操作の後に起動を頼み、
// Cloud Scheduler も10分ごとに起動する(再試行の待ちと、起動を頼めなかった分の見回り)。
// ローカル: pnpm outbox:once(1回だけ流す)。
// outbox を空になるまで(OUTBOX_DRAIN_MAX 件まで)処理して終わる。1件でも failed(dead / 直らない失敗)にしたら終了コード1。
runOneShot('outbox-drain', async (container, _env, stop) => {
  const result = await drainOutboxOnce(container, { stop });
  return { ok: result.failed === 0 };
});
