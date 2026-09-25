import {
  DATA_EXPORT_SCOPES,
  DATA_EXPORT_STATUSES,
  DATA_SUBJECT_REQUEST_KINDS,
  DATA_SUBJECT_REQUEST_STATUSES,
  DATA_SUBJECT_TYPES,
  RETENTION_TARGETS,
} from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, date, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, idColumn, oneOf, tenantIdColumn, updatedAt } from './_columns';
import { tenantFk, tenantIsolation, tenantRef, tenantScoped } from './_helpers';
import { bytea } from './_types';
import { storedFiles } from './records';
import { staff } from './staff';

/**
 * SaaS の運用(データの書き出し・本人からの開示/削除等の請求・保存期間)のテーブル。
 * 現時点ではテーブルだけを用意し、処理(書き出し・消去のジョブ・画面)は未実装。
 */

export const dataExportRequests = pgTable(
  'data_export_requests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    requestedBy: uuid(),
    scope: text({ enum: DATA_EXPORT_SCOPES }).notNull(),
    subjectId: uuid(),
    status: text({ enum: DATA_EXPORT_STATUSES }).notNull().default('requested'),
    fileId: uuid(),
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('data_export_requests', t),
    tenantRef('data_export_requests', 'requested_by', t, t.requestedBy, staff),
    tenantRef('data_export_requests', 'file_id', t, t.fileId, storedFiles),
    check('data_export_requests_scope_check', oneOf(t.scope, DATA_EXPORT_SCOPES)),
    check('data_export_requests_status_check', oneOf(t.status, DATA_EXPORT_STATUSES)),
    check('data_export_requests_subject_check', sql`(${t.scope} = 'tenant') = (${t.subjectId} is null)`),
  ],
).enableRLS();

export const dataSubjectRequests = pgTable(
  'data_subject_requests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    kind: text({ enum: DATA_SUBJECT_REQUEST_KINDS }).notNull(),
    subjectType: text({ enum: DATA_SUBJECT_TYPES }).notNull(),
    subjectId: uuid().notNull(),
    status: text({ enum: DATA_SUBJECT_REQUEST_STATUSES }).notNull().default('received'),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    dueOn: date(),
    completedAt: timestamp({ withTimezone: true }),
    notesEnc: bytea(),
    handledBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('data_subject_requests', t),
    tenantRef('data_subject_requests', 'handled_by', t, t.handledBy, staff),
    check('data_subject_requests_kind_check', oneOf(t.kind, DATA_SUBJECT_REQUEST_KINDS)),
    check('data_subject_requests_subject_type_check', oneOf(t.subjectType, DATA_SUBJECT_TYPES)),
    check('data_subject_requests_status_check', oneOf(t.status, DATA_SUBJECT_REQUEST_STATUSES)),
  ],
).enableRLS();

/** 対象ごとの保存期間の上書き(legal_hold 中は消さない)。行が無ければコードの既定値。 */
export const retentionPolicies = pgTable(
  'retention_policies',
  {
    tenantId: tenantIdColumn(),
    target: text({ enum: RETENTION_TARGETS }).notNull(),
    retainDays: integer().notNull(),
    legalHold: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'retention_policies_pkey', columns: [t.tenantId, t.target] }),
    tenantFk('retention_policies', t),
    tenantIsolation(),
    check('retention_policies_target_check', oneOf(t.target, RETENTION_TARGETS)),
    check('retention_policies_retain_days_check', sql`${t.retainDays} >= 1`),
  ],
).enableRLS();
