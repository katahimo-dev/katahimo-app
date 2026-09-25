import { createHmac } from 'node:crypto';
import type { RateLimitDecision, RateLimitRule } from '@katahimo/core/domain';
import { consumeRateLimit, refundRateLimit } from '@katahimo/core/domain';
import type { RateLimiterPort } from '@katahimo/core/ports';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../client';
import { rateLimitBuckets } from '../../schema';

/**
 * RateLimiterPort の Postgres 実装(platform.rate_limit_buckets。Cloud Run の複数インスタンスで回数を共有)。
 * consume は1トランザクションの中で行を作り(ON CONFLICT DO NOTHING)、SELECT … FOR UPDATE で押さえてから
 * 数える(同時の要求でも上限を超えない)。対象は HMAC-SHA256(keySecret) にしてから保存する
 * (IPアドレス・ログインIDを平文で残さない)。古い行はワーカーの保守ジョブが消す。
 */
export class DrizzleRateLimiter implements RateLimiterPort {
  constructor(
    private readonly db: Database,
    private readonly keySecret: string,
  ) {}

  private subject(key: string): Buffer {
    return createHmac('sha256', this.keySecret).update(key, 'utf8').digest();
  }

  private where(rule: RateLimitRule, key: string) {
    return and(eq(rateLimitBuckets.rule, rule.name), eq(rateLimitBuckets.subjectHash, this.subject(key)));
  }

  consume(rule: RateLimitRule, key: string, now: Date): Promise<RateLimitDecision> {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(rateLimitBuckets)
        .values({
          rule: rule.name,
          subjectHash: this.subject(key),
          windowStart: now,
          hits: 0,
          updatedAt: now,
        })
        .onConflictDoNothing();
      const [row] = await tx.select().from(rateLimitBuckets).where(this.where(rule, key)).for('update');
      if (!row) throw new Error(`レート制限の記録を取得できません(${rule.name})`);
      const next = consumeRateLimit(
        { windowStart: row.windowStart, count: row.hits, blockedUntil: row.blockedUntil },
        rule,
        now,
      );
      await tx
        .update(rateLimitBuckets)
        .set({
          windowStart: next.bucket.windowStart,
          hits: next.bucket.count,
          blockedUntil: next.bucket.blockedUntil,
        })
        .where(this.where(rule, key));
      return next.decision;
    });
  }

  refund(rule: RateLimitRule, key: string): Promise<void> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(rateLimitBuckets).where(this.where(rule, key)).for('update');
      if (!row) return;
      const next = refundRateLimit(
        { windowStart: row.windowStart, count: row.hits, blockedUntil: row.blockedUntil },
        rule,
      );
      await tx
        .update(rateLimitBuckets)
        .set({ hits: next.count, blockedUntil: next.blockedUntil })
        .where(this.where(rule, key));
    });
  }

  async reset(rule: RateLimitRule, key: string): Promise<void> {
    await this.db.delete(rateLimitBuckets).where(this.where(rule, key));
  }
}
