import { type DrainOutboxResult, drainOutbox } from '@katahimo/core/usecases';
import type { WorkerContainer } from '../container';
import { logJson } from './log';
import type { StopSignal } from './stopSignal';

/**
 * outbox を空になるまで(または maxMessages 件まで)1件ずつ処理する。テナントを横断して FOR UPDATE SKIP LOCKED で
 * 取り出すため、ワーカーが複数動いても同じメッセージを二重に処理しない。
 */
export async function drainOutboxOnce(
  container: WorkerContainer,
  options: { maxMessages: number; stop?: StopSignal },
): Promise<DrainOutboxResult> {
  const result = await drainOutbox(container, {
    maxMessages: options.maxMessages,
    ...(options.stop ? { shouldStop: () => options.stop?.stopped ?? false } : {}),
  });
  if (result.done + result.skipped + result.retried + result.failed + result.lease_lost > 0) {
    logJson('INFO', 'outbox を処理しました', { ...result });
  }
  return result;
}

/** 停止の合図まで outbox を処理し続ける常駐ループ。空になったら intervalMs 待つ(合図が来ればすぐに抜ける)。 */
export async function runOutboxPoller(
  container: WorkerContainer,
  options: { intervalMs: number; maxMessages: number; stop: StopSignal },
): Promise<void> {
  while (!options.stop.stopped) {
    try {
      const result = await drainOutboxOnce(container, options);
      // 上限まで処理した(まだ残っている)なら待たずに続ける
      const handled = result.done + result.skipped + result.retried + result.failed + result.lease_lost;
      if (handled >= options.maxMessages) continue;
    } catch (error) {
      logJson('ERROR', 'outbox の処理中にエラーが発生しました', { error: String(error) });
    }
    await options.stop.sleep(options.intervalMs);
  }
}
