import { createHmac } from 'node:crypto';
import type { RateLimitDecision, RateLimitRule } from '@katahimo/core/domain';
import { consumeRateLimit, peekRateLimit } from '@katahimo/core/domain';
import type { RateLimiterPort } from '@katahimo/core/ports';
import { and, eq, lt } from 'drizzle-orm';
import type { Database } from '../client';
import { rateLimitBuckets } from '../schema';

/** この期間更新の無い行は、どの規則でも窓・ロックが明けているため消してよい(最長の窓は1日)。 */
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;
/** 古い行の掃除をする頻度(記録のおよそ何回に1回か)。 */
const CLEANUP_EVERY = 200;

/**
 * RateLimiterPort の Postgres 実装(rate_limit_buckets)。Cloud Run の複数インスタンスで回数を共有する。
 *
 * - consume は1トランザクションの中で、行が無ければ作り(INSERT ... ON CONFLICT DO NOTHING)、
 *   SELECT ... FOR UPDATE で行ロックを取ってから domain/rateLimit の consumeRateLimit で次の状態を
 *   計算して書き戻す。同じキーへの同時の要求はロックで順番に数えられ、上限を超えて通らない。
 * - キーは HMAC-SHA256(keySecret) にしてから保存する(IPアドレス・ログインIDを平文で残さない)。
 * - rate_limit_buckets はテナントを特定する前にも使うためRLS対象外(withTenant を使わない)。
 */
export class DrizzleRateLimiter implements RateLimiterPort {
  private consumed = 0;

  constructor(
    private readonly db: Database,
    private readonly keySecret: string,
  ) {}

  private hashKey(key: string): string {
    return createHmac('sha256', this.keySecret).update(key, 'utf8').digest('hex');
  }

  async consume(rule: RateLimitRule, key: string, now: Date): Promise<RateLimitDecision> {
    const keyHash = this.hashKey(key);
    const where = and(eq(rateLimitBuckets.bucket, rule.name), eq(rateLimitBuckets.keyHash, keyHash));
    const decision = await this.db.transaction(async (tx) => {
      await tx
        .insert(rateLimitBuckets)
        .values({ bucket: rule.name, keyHash, windowStart: now, count: 0, updatedAt: now })
        .onConflictDoNothing();
      const rows = await tx.select().from(rateLimitBuckets).where(where).for('update');
      const row = rows[0];
      if (!row) throw new Error(`レート制限の記録を取得できません(${rule.name})`);
      const next = consumeRateLimit(row, rule, now);
      await tx
        .update(rateLimitBuckets)
        .set({ ...next.bucket, updatedAt: now })
        .where(where);
      return next.decision;
    });
    if (++this.consumed % CLEANUP_EVERY === 0) await this.deleteStale(now);
    return decision;
  }

  async peek(rule: RateLimitRule, key: string, now: Date): Promise<RateLimitDecision> {
    const rows = await this.db
      .select()
      .from(rateLimitBuckets)
      .where(and(eq(rateLimitBuckets.bucket, rule.name), eq(rateLimitBuckets.keyHash, this.hashKey(key))));
    return peekRateLimit(rows[0] ?? null, rule, now);
  }

  async reset(rule: RateLimitRule, key: string): Promise<void> {
    await this.db
      .delete(rateLimitBuckets)
      .where(and(eq(rateLimitBuckets.bucket, rule.name), eq(rateLimitBuckets.keyHash, this.hashKey(key))));
  }

  /** 長く更新の無い行を消す(失敗しても本来の処理は止めない)。 */
  private async deleteStale(now: Date): Promise<void> {
    try {
      await this.db
        .delete(rateLimitBuckets)
        .where(lt(rateLimitBuckets.updatedAt, new Date(now.getTime() - STALE_AFTER_MS)));
    } catch (e) {
      console.error('rate_limit_buckets の古い行の削除に失敗しました', e instanceof Error ? e.message : e);
    }
  }
}
