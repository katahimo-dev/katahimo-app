/**
 * レート制限(固定窓カウンタ+一時ロック)の純粋な計算。RateLimiterPort の実装(Postgres・テスト用の
 * インメモリ)はどちらもこの関数で次の状態を決め、判定がずれないようにする。
 */

/** 規則。rate_limit_buckets.bucket の値は name。 */
export interface RateLimitRule {
  /** 規則名(英小文字とアンダースコア)。 */
  name: string;
  /** 窓の中で許す回数。 */
  limit: number;
  /** 窓の長さ(ミリ秒)。 */
  windowMs: number;
  /**
   * 回数が上限に達したときに一時ロックする時間(ミリ秒)。ロック中は窓が明けても数え直さず拒否し続ける。
   * 省略時はロックせず、窓が明けるまで拒否する(利用回数の上限=クォータ向け)。
   */
  lockMs?: number;
}

/** 1つの規則×キーの記録(rate_limit_buckets の1行)。 */
export interface RateLimitBucket {
  windowStart: Date;
  count: number;
  blockedUntil: Date | null;
}

export interface RateLimitDecision {
  /** この回を許可するか(consume)/次の1回が許可されるか(peek)。 */
  allowed: boolean;
  /** 現在の窓での回数(consume は今回の分を含む)。 */
  count: number;
  /** 拒否した場合、再び許可されるまでのおおよその時間(ミリ秒)。許可した場合は0。 */
  retryAfterMs: number;
  /** 今回の consume で一時ロックが始まったか(ログ記録用)。 */
  lockStarted: boolean;
}

function isLocked(bucket: RateLimitBucket, now: Date): boolean {
  return bucket.blockedUntil !== null && bucket.blockedUntil.getTime() > now.getTime();
}

/** 窓が明けた(またはロックが解けた)ため、次の記録を1から数え直すか。 */
function isExpired(bucket: RateLimitBucket, rule: RateLimitRule, now: Date): boolean {
  if (bucket.blockedUntil !== null) return bucket.blockedUntil.getTime() <= now.getTime();
  return bucket.windowStart.getTime() + rule.windowMs <= now.getTime();
}

function retryAfterOf(bucket: RateLimitBucket, rule: RateLimitRule, now: Date): number {
  const until = isLocked(bucket, now)
    ? (bucket.blockedUntil as Date).getTime()
    : bucket.windowStart.getTime() + rule.windowMs;
  return Math.max(0, until - now.getTime());
}

/** 1回分を記録した後の状態と、その回の判定。 */
export function consumeRateLimit(
  previous: RateLimitBucket | null,
  rule: RateLimitRule,
  now: Date,
): { bucket: RateLimitBucket; decision: RateLimitDecision } {
  const restart = previous === null || isExpired(previous, rule, now);
  const base: RateLimitBucket = restart
    ? { windowStart: now, count: 0, blockedUntil: null }
    : (previous as RateLimitBucket);
  const count = base.count + 1;
  const wasLocked = isLocked(base, now);
  const lockStarted = !wasLocked && rule.lockMs !== undefined && count >= rule.limit;
  const bucket: RateLimitBucket = {
    windowStart: base.windowStart,
    count,
    blockedUntil: lockStarted ? new Date(now.getTime() + (rule.lockMs as number)) : base.blockedUntil,
  };
  const allowed = !wasLocked && count <= rule.limit;
  return {
    bucket,
    decision: {
      allowed,
      count,
      retryAfterMs: allowed ? 0 : retryAfterOf(bucket, rule, now),
      lockStarted,
    },
  };
}

/** 記録せずに、次の1回が許可されるかを判定する(ログイン前のロック確認用)。 */
export function peekRateLimit(
  bucket: RateLimitBucket | null,
  rule: RateLimitRule,
  now: Date,
): RateLimitDecision {
  if (bucket === null || isExpired(bucket, rule, now)) {
    return { allowed: true, count: 0, retryAfterMs: 0, lockStarted: false };
  }
  const allowed = !isLocked(bucket, now) && bucket.count < rule.limit;
  return {
    allowed,
    count: bucket.count,
    retryAfterMs: allowed ? 0 : retryAfterOf(bucket, rule, now),
    lockStarted: false,
  };
}

/**
 * consume で数えた1回分を取り消した後の状態(先に数えてから評価した回が成功だった場合)。取り消して上限を
 * 下回るなら、その回で始まったロックも解く(上限に達した回そのものが成功だった)。
 */
export function refundRateLimit(bucket: RateLimitBucket, rule: RateLimitRule): RateLimitBucket {
  const count = Math.max(0, bucket.count - 1);
  return {
    windowStart: bucket.windowStart,
    count,
    blockedUntil: count < rule.limit ? null : bucket.blockedUntil,
  };
}
