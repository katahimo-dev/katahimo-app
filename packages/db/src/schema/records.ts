import {
  AI_PROMPT_KINDS,
  CARE_RECORD_STATUSES,
  CARE_RECORD_TYPES,
  type CareRecordContent,
  STORED_FILE_PURPOSES,
} from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
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
  rowVersion,
  tenantIdColumn,
  updatedAt,
} from './_columns';
import { tenantFk, tenantIsolation, tenantRef, tenantScoped } from './_helpers';
import { bytea, tstzrange } from './_types';
import { visits } from './attendance';
import { careRecipients, customers } from './customers';
import { staff } from './staff';

/**
 * 記録(保育日報・事故報告・ヒヤリハット)。本文 body は record_type ごとの型つき JSON(body_schema_ver で版を
 * 管理。形は core/domain/reports/types.ts)。並び替え・集計に使う日時・評価は列に持つ。
 * PSI/ES の評価(risk_rating / es_rating)は日報だけが持つ。
 * 提出済み(submitted / locked)の記録の本文が変わると、トリガー(care_records_route_revision)が変更前の
 * 本文を care_record_revisions に写す。locked の記録の本文は変更できない。
 */
export const careRecords = pgTable(
  'care_records',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    recordType: text({ enum: CARE_RECORD_TYPES }).notNull(),
    status: text({ enum: CARE_RECORD_STATUSES }).notNull().default('submitted'),
    visitId: uuid(),
    customerId: uuid().notNull(),
    careRecipientId: uuid(),
    authorStaffId: uuid().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    servicePeriod: tstzrange(),
    riskRating: smallint(),
    esRating: smallint(),
    body: jsonb().$type<CareRecordContent>().notNull(),
    bodySchemaVer: smallint().notNull().default(1),
    aiGenerated: boolean().notNull().default(false),
    aiModel: text(),
    aiPromptKey: text(),
    aiPromptRevision: integer(),
    reviewedAt: timestamp({ withTimezone: true }),
    retainUntil: date(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('care_records', t),
    tenantRef('care_records', 'visit_id', t, t.visitId, visits),
    tenantRef('care_records', 'customer_id', t, t.customerId, customers),
    tenantRef('care_records', 'care_recipient_id', t, t.careRecipientId, careRecipients),
    tenantRef('care_records', 'author_staff_id', t, t.authorStaffId, staff),
    index('care_records_tenant_id_customer_id_occurred_at_id_idx').on(
      t.tenantId,
      t.customerId,
      t.occurredAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // テナント全体の報告の一覧(新しい順・keyset(occurred_at, id))
    index('care_records_tenant_id_occurred_at_id_idx').on(
      t.tenantId,
      t.occurredAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('care_records_tenant_id_author_staff_id_occurred_at_idx').on(
      t.tenantId,
      t.authorStaffId,
      t.occurredAt.desc().nullsFirst(),
    ),
    index('care_records_tenant_id_visit_id_idx').on(t.tenantId, t.visitId),
    check('care_records_record_type_check', oneOf(t.recordType, CARE_RECORD_TYPES)),
    check('care_records_status_check', oneOf(t.status, CARE_RECORD_STATUSES)),
    check('care_records_risk_rating_check', sql`${t.riskRating} between 1 and 5`),
    check('care_records_es_rating_check', sql`${t.esRating} between 1 and 5`),
    check(
      'care_records_ratings_check',
      sql`${t.recordType} = 'daily_report' or (${t.riskRating} is null and ${t.esRating} is null)`,
    ),
    check('care_records_service_period_check', sql`not isempty(${t.servicePeriod})`),
  ],
).enableRLS();

/**
 * 記録の本文の変更履歴(追記のみ。アプリロールは SELECT / INSERT だけ)。トリガーが変更前の本文と版を写す。
 * 記録への参照は no action(履歴のある記録は消せない。記録と一緒に履歴が消えないようにする)。テナントの
 * 消去(platform.purge_tenant)は tenant_id の cascade で記録と履歴を同じ文で消すため妨げない。
 */
export const careRecordRevisions = pgTable(
  'care_record_revisions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    careRecordId: uuid().notNull(),
    revisionNo: integer().notNull(),
    body: jsonb().$type<CareRecordContent>().notNull(),
    bodySchemaVer: smallint().notNull(),
    /** 変更したスタッフ(セッションの app.actor_staff_id。無ければ null)。 */
    changedBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('care_record_revisions', t),
    tenantRef('care_record_revisions', 'care_record_id', t, t.careRecordId, careRecords),
    unique(constraintName('care_record_revisions', ['tenant_id', 'care_record_id', 'revision_no'], 'key')).on(
      t.tenantId,
      t.careRecordId,
      t.revisionNo,
    ),
  ],
).enableRLS();

/**
 * 保存したファイル(実体は GCS / ローカル。DBはメタデータだけ)。どこからも参照されなくなったファイルは
 * ワーカーの掃除ジョブが消す。
 */
export const storedFiles = pgTable(
  'stored_files',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    storageKey: text().notNull(),
    contentType: text().notNull(),
    byteSize: integer().notNull(),
    sha256: bytea().notNull(),
    purpose: text({ enum: STORED_FILE_PURPOSES }).notNull(),
    createdBy: uuid(),
    retainUntil: date(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('stored_files', t),
    tenantRef('stored_files', 'created_by', t, t.createdBy, staff),
    unique('stored_files_tenant_id_storage_key_key').on(t.tenantId, t.storageKey),
    check('stored_files_purpose_check', oneOf(t.purpose, STORED_FILE_PURPOSES)),
    check('stored_files_byte_size_check', sql`${t.byteSize} >= 0`),
  ],
).enableRLS();

/** 領収書の1回の登録操作(複数枚の束)。申し送り(handoff_text)はここに1つだけ持つ。 */
export const receiptUploads = pgTable(
  'receipt_uploads',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    customerId: uuid(),
    customerNameText: text(),
    handoffText: text(),
    createdBy: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('receipt_uploads', t),
    tenantRef('receipt_uploads', 'staff_id', t, t.staffId, staff),
    tenantRef('receipt_uploads', 'customer_id', t, t.customerId, customers),
    tenantRef('receipt_uploads', 'created_by', t, t.createdBy, staff),
  ],
).enableRLS();

/**
 * 領収書1枚。金額は整数(円)。重複の判定は dedupe_hash(スタッフ・顧客・日時・金額・店名を正規化した
 * キーの SHA-256。core/domain/reports/receiptDedupe.ts)の部分UNIQUE で、INSERT … ON CONFLICT DO NOTHING が
 * 同時の登録でも原子的に重複を弾く。取消済みの行は UNIQUE の対象外(同じ領収書を登録し直せる)。
 *
 * 会計の記録なので行は消さない(アプリのロールに DELETE の権限は無い)。間違えた登録は取消(cancelled_at・
 * cancelled_by・cancel_reason を入れる論理削除)にして一覧に残し、合計・CSV・Excel からは除く。登録後に
 * 変えられるのは取消の列と row_version だけ(列ごとの UPDATE 権限。0001_baseline_custom.sql)。
 */
export const receipts = pgTable(
  'receipts',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    uploadId: uuid().notNull(),
    fileId: uuid().notNull(),
    staffId: uuid().notNull(),
    customerId: uuid(),
    customerNameText: text(),
    receiptedAt: timestamp({ withTimezone: true }).notNull(),
    amountYen: integer(),
    storeName: text(),
    /**
     * 会社負担(研修等の同行・会社の都合で出た駐車場代など)。スタッフへの支払いは同じ(月の合計に入る)だが、
     * お客様には請求しない。登録のときに決め、後から変えない(直すときは取消して登録し直す)。
     */
    companyPaid: boolean().notNull().default(false),
    dedupeHash: bytea(),
    /** 取消の日時(取消済みの行は合計・CSV・Excel・重複の判定から除く)。null は有効な領収書。 */
    cancelledAt: timestamp({ withTimezone: true }),
    /** 取消したスタッフ(本人、または管理者・コーディネーター)。 */
    cancelledBy: uuid(),
    /** 取消の理由(任意・1行・100文字まで)。 */
    cancelReason: text(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('receipts', t),
    tenantRef('receipts', 'upload_id', t, t.uploadId, receiptUploads, 'cascade'),
    tenantRef('receipts', 'file_id', t, t.fileId, storedFiles),
    tenantRef('receipts', 'staff_id', t, t.staffId, staff),
    tenantRef('receipts', 'customer_id', t, t.customerId, customers),
    tenantRef('receipts', 'cancelled_by', t, t.cancelledBy, staff),
    uniqueIndex('receipts_tenant_id_dedupe_hash_key')
      .on(t.tenantId, t.dedupeHash)
      .where(sql`dedupe_hash is not null and cancelled_at is null`),
    index('receipts_tenant_id_staff_id_receipted_at_idx').on(t.tenantId, t.staffId, t.receiptedAt),
    // テナント全体の領収書の一覧(月の範囲・新しい順・keyset(receipted_at, id))
    index('receipts_tenant_id_receipted_at_id_idx').on(
      t.tenantId,
      t.receiptedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('receipts_tenant_id_upload_id_idx').on(t.tenantId, t.uploadId),
    index('receipts_tenant_id_file_id_idx').on(t.tenantId, t.fileId),
    check('receipts_amount_yen_check', sql`${t.amountYen} >= 0`),
    // 取消の列は揃って入る(理由は任意)。有効な行に取消の理由・取消した人だけが残ることはない
    check(
      'receipts_cancel_check',
      sql`(${t.cancelledAt} is null and ${t.cancelledBy} is null and ${t.cancelReason} is null) or (${t.cancelledAt} is not null and ${t.cancelledBy} is not null)`,
    ),
    // 取消の理由は1行(改行などの制御文字なし)・100文字まで(@katahimo/shared RECEIPT_CANCEL_REASON_MAX_LENGTH)
    check(
      'receipts_cancel_reason_check',
      sql`char_length(${t.cancelReason}) <= 100 and ${t.cancelReason} !~ '[[:cntrl:]]'`,
    ),
  ],
).enableRLS();

/**
 * テナントが上書きした AI プロンプト・入力欄の案内文(行が無い key はコードの既定値)。
 * 保存のたびに revision を上げ、全ての版を ai_prompt_revisions(追記のみ)に残す。
 */
export const aiPrompts = pgTable(
  'ai_prompts',
  {
    tenantId: tenantIdColumn(),
    key: text().notNull(),
    kind: text({ enum: AI_PROMPT_KINDS }).notNull(),
    body: text().notNull(),
    revision: integer().notNull().default(1),
    updatedBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'ai_prompts_pkey', columns: [t.tenantId, t.key] }),
    tenantFk('ai_prompts', t),
    tenantIsolation(),
    tenantRef('ai_prompts', 'updated_by', t, t.updatedBy, staff),
    check('ai_prompts_kind_check', oneOf(t.kind, AI_PROMPT_KINDS)),
    check('ai_prompts_revision_check', sql`${t.revision} >= 1`),
  ],
).enableRLS();

/** AI プロンプトの版の履歴(追記のみ。body が null の版は「既定値に戻した」)。 */
export const aiPromptRevisions = pgTable(
  'ai_prompt_revisions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    key: text().notNull(),
    revision: integer().notNull(),
    body: text(),
    createdBy: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('ai_prompt_revisions', t),
    unique(constraintName('ai_prompt_revisions', ['tenant_id', 'key', 'revision'], 'key')).on(
      t.tenantId,
      t.key,
      t.revision,
    ),
  ],
).enableRLS();
