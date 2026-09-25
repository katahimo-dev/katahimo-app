import { CHANGE_SOURCES, ENTITY_TYPES, OUTBOX_STATUSES, OUTBOX_TOPICS } from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, idColumn, oneOf, tenantIdColumn } from './_columns';
import { tenantScoped } from './_helpers';
import { bytea } from './_types';

/**
 * トランザクショナル・アウトボックス。ドメインの書き込みと同じトランザクションで積み、ワーカーが
 * 1件ずつ取り出して送る(スプレッドシートへのミラー・メール)。
 * - payload は ID 等だけ(個人情報を入れない。ワーカーが DB から読み直す)。
 * - dedupe_key は決定的(`<topic>:<aggregate_id>:<版>`)で、同じ書き込みの再試行が二重に積まれない。
 * - ワーカーはテナントを横断して FOR UPDATE SKIP LOCKED で取り、locked_until(リース)を過ぎた
 *   processing は取り直す。ワーカー用のポリシー(outbox_messages_worker)は 0001_baseline_custom.sql。
 */
export const outboxMessages = pgTable(
  'outbox_messages',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    topic: text({ enum: OUTBOX_TOPICS }).notNull(),
    aggregateType: text().notNull(),
    aggregateId: uuid().notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text().notNull(),
    status: text({ enum: OUTBOX_STATUSES }).notNull().default('pending'),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(8),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedUntil: timestamp({ withTimezone: true }),
    lockedBy: text(),
    lastError: text(),
    createdAt: createdAt(),
    completedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    ...tenantScoped('outbox_messages', t),
    unique('outbox_messages_tenant_id_dedupe_key_key').on(t.tenantId, t.dedupeKey),
    index('outbox_messages_available_at_idx').on(t.availableAt).where(sql`status = 'pending'`),
    index('outbox_messages_locked_until_idx').on(t.lockedUntil).where(sql`status = 'processing'`),
    index('outbox_messages_completed_at_idx')
      .on(t.completedAt)
      .where(sql`status in ('done', 'failed', 'dead')`),
    check('outbox_messages_topic_check', oneOf(t.topic, OUTBOX_TOPICS)),
    check('outbox_messages_status_check', oneOf(t.status, OUTBOX_STATUSES)),
    check('outbox_messages_attempts_check', sql`${t.attempts} >= 0 and ${t.maxAttempts} >= 1`),
    check('outbox_messages_lock_check', sql`(${t.status} = 'processing') = (${t.lockedUntil} is not null)`),
  ],
).enableRLS();

/**
 * 実体の変更履歴(追記のみ。アプリロールは SELECT / INSERT だけ)。誰が・何で(手入力・カレンダー反映・
 * 取込・システム)・どの項目を変えたかと、変更前の値(暗号化。AAD は entity_changes.before と
 * この行のID。元の行の暗号文をそのまま写さず、履歴の用途で暗号化し直す)。
 */
export const entityChanges = pgTable(
  'entity_changes',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    entityType: text({ enum: ENTITY_TYPES }).notNull(),
    entityId: uuid().notNull(),
    changedBy: uuid(),
    changeSource: text({ enum: CHANGE_SOURCES }).notNull(),
    changedFields: text().array().notNull(),
    beforeEnc: bytea(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('entity_changes', t),
    index('entity_changes_tenant_id_entity_type_entity_id_created_at_idx').on(
      t.tenantId,
      t.entityType,
      t.entityId,
      t.createdAt,
    ),
    check('entity_changes_entity_type_check', oneOf(t.entityType, ENTITY_TYPES)),
    check('entity_changes_change_source_check', oneOf(t.changeSource, CHANGE_SOURCES)),
  ],
).enableRLS();
