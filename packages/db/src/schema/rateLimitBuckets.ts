import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * レート制限・一時ロックのカウンタ(RateLimiterPort の Postgres 実装が使う)。Cloud Run の複数インスタンス間で
 * 共有するためプロセス内ではなくDBに持つ。1行 = 1つの規則(bucket)× 1つのキー(ログインID・IPアドレス等)。
 *
 * - bucket: 規則名('login_failure_account' / 'login_failure_ip' / 'password_reset_request_ip' /
 *   'ai_generate_staff' 等。packages/core/src/usecases/rateLimits.ts)。
 * - key_hash: キーのHMAC-SHA256(hex)。IPアドレス・ログインIDを平文で保存しないため、サーバー側の秘密値で
 *   ハッシュ化してから渡す(鍵はSESSION_SECRETからHKDFで導出)。
 * - window_start / count: 固定窓のカウンタ。窓(規則のwindowMs)を過ぎた最初の記録で1から数え直す。
 * - blocked_until: 上限に達したときの一時ロックの解除時刻(ロックを伴う規則のみ)。
 * - updated_at: 最終更新。古い行はアダプタが時々まとめて削除する(updated_at の索引を使う)。
 *
 * テナントを特定する前(ログイン・パスワード再設定の送信元IP単位)にも使うため tenant_id を持たず、
 * tenants と同じくRLS対象外。キーはハッシュ化済みで個人情報を含まない。
 */
export const rateLimitBuckets = pgTable(
  'rate_limit_buckets',
  {
    bucket: text().notNull(),
    keyHash: text().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull(),
    blockedUntil: timestamp({ withTimezone: true }),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'rate_limit_buckets_pk', columns: [t.bucket, t.keyHash] }),
    index('rate_limit_buckets_updated_at_idx').on(t.updatedAt),
    check('rate_limit_buckets_count_check', sql`${t.count} >= 0`),
  ],
);
