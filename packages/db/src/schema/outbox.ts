import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * ミラー書き込み(DB → Googleスプレッドシート等)のジョブキュー。
 * ドメインの書き込みと同一トランザクションでここに積み、ミラーワーカー(Phase 5)が
 * 非同期に処理する(packages/core/src/ports/mirror.ts のMirrorPort参照)。
 *
 * リトライ: attemptsは取得(claim)のたびに+1する試行回数、next_attempt_atは次に取得してよい
 * 最早時刻(失敗時にワーカーが指数バックオフで先送りする)、last_errorは直近の失敗内容。
 * ワーカーは status='pending' かつ next_attempt_at <= now() の行だけを取得する。
 */
export const outboxJobs = pgTable(
  'outbox_jobs',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    kind: text().notNull(),
    targetId: uuid().notNull(),
    idempotencyKey: text().notNull(),
    status: text({ enum: ['pending', 'processing', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer().notNull().default(0),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // テナントを跨いでidempotencyKeyの一意性を要求する理由はない(生成ロジック次第では
    // 他テナントの値と衝突しうる)ため、tenant_idでスコープする(データベース構造レビューで指摘)。
    uniqueIndex('outbox_jobs_tenant_idempotency_key_idx').on(t.tenantId, t.idempotencyKey),
    // ワーカーのポーリング(claimPending)用。
    index('outbox_jobs_tenant_status_next_attempt_idx').on(t.tenantId, t.status, t.nextAttemptAt),
    unique('outbox_jobs_tenant_id_uk').on(t.tenantId, t.id),
  ],
).enableRLS();
