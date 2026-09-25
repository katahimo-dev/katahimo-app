import { sql } from 'drizzle-orm';
import { integer, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * ミラー書き込み(DB → Googleスプレッドシート等)のジョブキュー。
 * ドメインの書き込みと同一トランザクションでここに積み、ミラーワーカー(Phase 5)が
 * 非同期に処理する(packages/core/src/ports/mirror.ts のMirrorPort参照)。
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
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // テナントを跨いでidempotencyKeyの一意性を要求する理由はない(生成ロジック次第では
    // 他テナントの値と衝突しうる)ため、tenant_idでスコープする(データベース構造レビューで指摘)。
    uniqueIndex('outbox_jobs_tenant_idempotency_key_idx').on(t.tenantId, t.idempotencyKey),
  ],
).enableRLS();
