import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_VALUE_TYPES,
  DATA_KEY_STATES,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  constraintName,
  createdAt,
  idColumn,
  oneOf,
  tenantIdColumn,
  updatedAt,
} from './_columns';
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

/**
 * テナントのデータ暗号化鍵(DEK)。平文の DEK は保存せず、KEK(Cloud KMS / 開発は LOCAL_DEV_KEK)で
 * ラップした値だけを持つ。版ごとに1行: active(暗号化に使う。テナントに1つ)/ decrypt_only(ローテーション後、
 * 古い暗号文の復号だけに使う)/ destroyed(暗号学的削除。wrapped_dek を消す)。暗号文の先頭に版を書くため、
 * 古い版の暗号文も読める。
 */
export const tenantDataKeys = pgTable(
  'tenant_data_keys',
  {
    tenantId: tenantIdColumn(),
    version: integer().notNull(),
    wrappedDek: bytea(),
    /** ラップに使った KEK の名前(Cloud KMS の鍵名、開発は 'local')。 */
    kekKeyName: text().notNull(),
    state: text({ enum: DATA_KEY_STATES }).notNull(),
    destroyedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'tenant_data_keys_pkey', columns: [t.tenantId, t.version] }),
    tenantFk('tenant_data_keys', t),
    tenantIsolation(),
    uniqueIndex('tenant_data_keys_tenant_id_active_key').on(t.tenantId).where(sql`state = 'active'`),
    check('tenant_data_keys_state_check', oneOf(t.state, DATA_KEY_STATES)),
    check('tenant_data_keys_version_check', sql`${t.version} between 1 and 65535`),
    check(
      'tenant_data_keys_wrapped_dek_check',
      sql`(${t.state} = 'destroyed') = (${t.wrappedDek} is null)`,
    ),
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
 * テナントの秘密値(Gemini API キー・Google Chat の Webhook URL)。値は暗号化(AAD にテナント・用途・name)。
 */
export const tenantSecrets = pgTable(
  'tenant_secrets',
  {
    tenantId: tenantIdColumn(),
    name: text({ enum: TENANT_SECRET_NAMES }).notNull(),
    valueEnc: bytea().notNull(),
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
 * 取込の実行記録(顧客CSV・スタッフ台帳)。最後に適用した顧客CSVの版は、source='reserva_csv' で
 * status='applied' の最新行の file_version。
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
      t.startedAt.desc(),
    ),
    check('import_runs_source_check', oneOf(t.source, IMPORT_SOURCES)),
    check('import_runs_status_check', oneOf(t.status, IMPORT_RUN_STATUSES)),
    check(
      'import_runs_finished_at_check',
      sql`(${t.status} = 'running') = (${t.finishedAt} is null)`,
    ),
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
