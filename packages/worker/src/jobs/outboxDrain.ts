import { errorMessageOf } from '@katahimo/core/domain';
import { type DrainOutboxResult, drainOutbox } from '@katahimo/core/usecases';
import type { WorkerContainer } from '../container';
import { logJson } from './log';
import type { StopSignal } from './stopSignal';

const handledCountOf = (result: DrainOutboxResult) =>
  result.done + result.skipped + result.retried + result.failed + result.lease_lost;

/**
 * outbox を空になるまで(または OUTBOX_DRAIN_MAX 件まで)1件ずつ処理する。テナントを横断して FOR UPDATE SKIP LOCKED で
 * 取り出すため、outbox-drain の実行が重なっても・バッチのジョブと同時に動いても同じメッセージを二重に処理しない。
 * 再試行を待っているもの(available_at が先)はここでは取らず、その時刻の後の実行(10分ごとの見回り等)が取る。
 */
export async function drainOutboxOnce(
  container: WorkerContainer,
  options: { stop?: StopSignal } = {},
): Promise<DrainOutboxResult> {
  const result = await drainOutbox(container, {
    maxMessages: container.outboxDrainMax,
    ...(options.stop ? { shouldStop: () => options.stop?.stopped ?? false } : {}),
  });
  if (handledCountOf(result) > 0) logJson('INFO', 'outbox を処理しました', { ...result });
  return result;
}

/**
 * バッチのジョブ(翌日の予定のお知らせ・夜間のカレンダー反映)の最後に、積んだ outbox をそのジョブの中で送る
 * (別のジョブの起動を頼まない)。ここでの失敗はジョブの成否に含めない: 送れなかったものは再試行の待ちか未処理のまま残り、
 * 10分ごとの見回りが処理する。
 */
export async function drainOutboxAfterBatch(
  container: WorkerContainer,
  jobName: string,
  stop?: StopSignal,
): Promise<void> {
  if (stop?.stopped) return;
  try {
    await drainOutboxOnce(container, stop ? { stop } : {});
  } catch (error) {
    logJson('WARNING', `${jobName}: 積んだ outbox を送れませんでした。見回りの実行で送ります`, {
      error: errorMessageOf(error),
    });
  }
}

/**
 * ローカル開発専用の見回り(pnpm worker)。停止の合図まで outbox を処理し続け、空になったら intervalMs 待つ
 * (合図が来ればすぐに抜ける)。本番は Cloud Run Jobs の outbox-drain(操作の後の起動の依頼と10分ごとの見回り)。
 */
export async function pollOutboxLocally(
  container: WorkerContainer,
  options: { intervalMs: number; stop: StopSignal },
): Promise<void> {
  while (!options.stop.stopped) {
    try {
      const result = await drainOutboxOnce(container, { stop: options.stop });
      // 上限まで処理した(まだ残っている)なら待たずに続ける
      if (handledCountOf(result) >= container.outboxDrainMax) continue;
    } catch (error) {
      logJson('ERROR', 'outbox の処理中にエラーが発生しました', { error: errorMessageOf(error) });
    }
    await options.stop.sleep(options.intervalMs);
  }
}
