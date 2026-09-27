import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_VALUE_TYPES,
  CUSTOMER_SOURCES,
  IMPORT_RUN_STATUSES,
  IMPORT_SOURCES,
  TENANT_SECRET_NAMES,
} from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { constraintName, createdAt, idColumn, oneOf, tenantIdColumn, updatedAt } from './_columns';
import { tenantFk, tenantIsolation, tenantRef, tenantScoped } from './_helpers';
import { bytea } from './_types';
import { staff } from './staff';

/** テナント単位の機能フラグの上書き(既定値は platform.plan_features → コードの既定値の順)。 */
export const tenantFeatures = pgTable(
  'tenant_features',
  {
    tenantId: tenantIdColumn(),
    featureKey: text().notNull(),
    enabled: boolean().notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'tenant_features_pkey', columns: [t.tenantId, t.featureKey] }),
    tenantFk('tenant_features', t),
    tenantIsolation(),
  ],
).enableRLS();

/** テナントの設定(秘密でない値)。1テナント1行。秘密値は tenant_secrets。 */
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: tenantIdColumn(),
    geminiReportModel: text(),
    geminiOcrModel: text(),
    /** 介護・保育記録(care_records)の保存期間(日)。retain_until の計算に使う。 */
    careRecordRetentionDays: integer().notNull().default(1825),
    /** 顧客データの版数。顧客CSVを取り込むたびに+1する(画面のキャッシュ無効化・予定のマスタのキャッシュキー)。 */
    customerDataVersion: bigint({ mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'tenant_settings_pkey', columns: [t.tenantId] }),
    tenantFk('tenant_settings', t),
    tenantIsolation(),
    check('tenant_settings_care_record_retention_days_check', sql`${t.careRecordRetentionDays} >= 365`),
  ],
).enableRLS();

/**
 * テナントの秘密値(Gemini API キー・Google Chat の Webhook URL)。値は SecretBox で封をした暗号文だけを持つ
 * (テナントID・name に結び付く。integrations/src/secret-box)。
 */
export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    tenantId: tenantIdColumn(),
    name: text({ enum: TENANT_SECRET_NAMES }).notNull(),
    sealedValue: bytea().notNull(),
    updatedBy: uuid(),
    rotatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'tenant_secrets_pkey', columns: [t.tenantId, t.name] }),
    tenantFk('tenant_secrets', t),
    tenantIsolation(),
    tenantRef('tenant_secrets', 'updated_by', t, t.updatedBy, staff),
    check('tenant_secrets_name_check', oneOf(t.name, TENANT_SECRET_NAMES)),
  ],
).enableRLS();

/**
 * 取込の実行記録(顧客CSV・スタッフ台帳・日報AIのマスター・GAS版のスプレッドシートからの移行)。最後に適用した
 * 顧客CSVの版は、source='reserva_csv' で status='applied' の最新行の file_version。GAS版からの移行の取込は
 * file_name に読んだスプレッドシートの ID を入れる。
 */
export const importRuns = pgTable(
  'import_runs',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    source: text({ enum: IMPORT_SOURCES }).notNull(),
    fileName: text(),
    fileVersion: text(),
    status: text({ enum: IMPORT_RUN_STATUSES }).notNull().default('running'),
    /** 件数(作成・更新・アーカイブ等)。個人情報は入れない。 */
    counts: jsonb().$type<Record<string, number>>().notNull().default({}),
    /** 失敗・要確認の理由(利用者向けの日本語)。 */
    message: text(),
    triggeredBy: uuid(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    ...tenantScoped('import_runs', t),
    tenantRef('import_runs', 'triggered_by', t, t.triggeredBy, staff),
    index(constraintName('import_runs', ['tenant_id', 'source', 'started_at'], 'idx')).on(
      t.tenantId,
      t.source,
      t.startedAt.desc().nullsFirst(),
    ),
    check('import_runs_source_check', oneOf(t.source, IMPORT_SOURCES)),
    check('import_runs_status_check', oneOf(t.status, IMPORT_RUN_STATUSES)),
    check('import_runs_finished_at_check', sql`(${t.status} = 'running') = (${t.finishedAt} is null)`),
  ],
).enableRLS();

/**
 * 外部システム連携の API キー(POST /api/integrations/customers。RESERVA 等からの顧客の受け取り)。
 * 運用担当者の `pnpm tenant:api-keys` だけが発行・失効させる(アプリのロールは読むことと last_used_at の
 * 更新だけ)。トークン(`kth_<テナントID>_<乱数>`)そのものは持たず、SHA-256 だけを持つ(発行時に1回だけ表示する)。
 * customer_source は、このキーで書ける顧客の取込元(customer_source_records.source)。消さずに revoked_at で失効させる。
 */
export const integrationApiKeys = pgTable(
  'integration_api_keys',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** 運用担当者が付ける名前(連携先の区別。例: 'RESERVA 本番')。 */
    name: text().notNull(),
    customerSource: text({ enum: CUSTOMER_SOURCES }).notNull(),
    tokenHash: bytea().notNull(),
    /** 発行した運用担当者(OS のユーザー名等。スタッフではない)。 */
    createdBy: text().notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    ...tenantScoped('integration_api_keys', t),
    unique(constraintName('integration_api_keys', ['tenant_id', 'token_hash'], 'key')).on(
      t.tenantId,
      t.tokenHash,
    ),
    check('integration_api_keys_customer_source_check', oneOf(t.customerSource, CUSTOMER_SOURCES)),
    check('integration_api_keys_name_check', sql`char_length(${t.name}) between 1 and 100`),
  ],
).enableRLS();

/** テナント独自の項目の定義(staff.custom_fields / customers.custom_fields のキー)。 */
export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    entityType: text({ enum: CUSTOM_FIELD_ENTITIES }).notNull(),
    key: text().notNull(),
    label: text().notNull(),
    valueType: text({ enum: CUSTOM_FIELD_VALUE_TYPES }).notNull().default('text'),
    options: jsonb().$type<string[]>().notNull().default([]),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('custom_field_definitions', t),
    unique(constraintName('custom_field_definitions', ['tenant_id', 'entity_type', 'key'], 'key')).on(
      t.tenantId,
      t.entityType,
      t.key,
    ),
    check('custom_field_definitions_entity_type_check', oneOf(t.entityType, CUSTOM_FIELD_ENTITIES)),
    check('custom_field_definitions_value_type_check', oneOf(t.valueType, CUSTOM_FIELD_VALUE_TYPES)),
  ],
).enableRLS();
