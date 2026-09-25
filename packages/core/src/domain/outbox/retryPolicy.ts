/**
 * outboxミラージョブの再試行方針(指数バックオフ+上限回数)。
 *
 * GAS版Bridgeは一時的に失敗しうる(Apps Scriptの同時実行ロック待ち・クォータ・デプロイ直後等)ため、
 * 失敗したジョブはすぐに捨てず、間隔を倍々に空けながら maxAttempts 回まで試す。
 * 上限に達したジョブは failed にして自動再試行をやめ、ERRORログで知らせる。
 */
export interface RetryPolicy {
  /** 最初の試行を含めた最大試行回数。 */
  maxAttempts: number;
  /** 1回目の失敗後の待ち時間。以後の失敗ごとに2倍にする。 */
  baseDelayMs: number;
  /** 待ち時間の上限。 */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 60 * 60_000,
};

export type FailureDecision = { kind: 'retry'; nextAttemptAt: Date; delayMs: number } | { kind: 'give_up' };

/** attempts 回目の試行が失敗した後、次に試すまでの待ち時間。 */
export function retryDelayMs(attempts: number, policy: RetryPolicy): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
}

/** attempts 回目(1始まり)の試行が失敗したとき、再試行するか諦めるか。 */
export function decideOnFailure(attempts: number, now: Date, policy: RetryPolicy): FailureDecision {
  if (attempts >= policy.maxAttempts) return { kind: 'give_up' };
  const delayMs = retryDelayMs(attempts, policy);
  return { kind: 'retry', delayMs, nextAttemptAt: new Date(now.getTime() + delayMs) };
}
