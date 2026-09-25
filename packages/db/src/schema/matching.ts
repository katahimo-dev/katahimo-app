import {
  AFFINITY_SOURCES,
  ATTRIBUTE_CATEGORIES,
  ATTRIBUTE_VALUE_TYPES,
  AVAILABILITY_EXCEPTION_KINDS,
  BUSY_BLOCK_SOURCES,
  CALENDAR_PURPOSES,
  MATCHING_RUN_STATUSES,
  TRAVEL_MODES,
} from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
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
import { bytea, daterange, tstzrange } from './_types';
import { customers } from './customers';
import { storedFiles } from './records';
import { reservations } from './services';
import { staff } from './staff';

/**
 * マッチング(管理者がスタッフを割り当てるアプリ)の入力データ(doc/10)。
 */

/** 属性(特技・資格・特性・言語)のカタログ。テナントが定義する参照テーブル。 */
export const attributeDefinitions = pgTable(
  'attribute_definitions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    category: text({ enum: ATTRIBUTE_CATEGORIES }).notNull(),
    key: text().notNull(),
    label: text().notNull(),
    valueType: text({ enum: ATTRIBUTE_VALUE_TYPES }).notNull().default('boolean'),
    maxLevel: smallint(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('attribute_definitions', t),
    unique('attribute_definitions_tenant_id_key_key').on(t.tenantId, t.key),
    check('attribute_definitions_category_check', oneOf(t.category, ATTRIBUTE_CATEGORIES)),
    check('attribute_definitions_value_type_check', oneOf(t.valueType, ATTRIBUTE_VALUE_TYPES)),
    check('attribute_definitions_max_level_check', sql`${t.maxLevel} >= 1`),
  ],
).enableRLS();

/**
 * スタッフの保有属性(有効期間つき。同じ属性の期間の重なりは EXCLUDE で禁止)。資格は確認日・確認者・
 * 証跡のファイルを持てる。
 */
export const staffAttributes = pgTable(
  'staff_attributes',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    attributeId: uuid().notNull(),
    level: smallint(),
    valueText: text(),
    valid: daterange()
      .notNull()
      .default(sql`'(,)'::daterange`),
    verifiedAt: timestamp({ withTimezone: true }),
    verifiedBy: uuid(),
    evidenceFileId: uuid(),
    noteEnc: bytea(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('staff_attributes', t),
    tenantRef('staff_attributes', 'staff_id', t, t.staffId, staff, 'cascade'),
    tenantRef('staff_attributes', 'attribute_id', t, t.attributeId, attributeDefinitions),
    tenantRef('staff_attributes', 'verified_by', t, t.verifiedBy, staff),
    tenantRef('staff_attributes', 'evidence_file_id', t, t.evidenceFileId, storedFiles),
    index('staff_attributes_tenant_id_attribute_id_idx').on(t.tenantId, t.attributeId),
    check('staff_attributes_level_check', sql`${t.level} >= 0`),
    check('staff_attributes_valid_check', sql`not isempty(${t.valid})`),
  ],
).enableRLS();

/** 顧客が求める属性(is_hard = 必須、false = できれば)。 */
export const customerRequiredAttributes = pgTable(
  'customer_required_attributes',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    attributeId: uuid().notNull(),
    minLevel: smallint(),
    isHard: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('customer_required_attributes', t),
    tenantRef('customer_required_attributes', 'customer_id', t, t.customerId, customers, 'cascade'),
    tenantRef(
      'customer_required_attributes',
      'attribute_id',
      t,
      t.attributeId,
      attributeDefinitions,
    ),
    unique(
      constraintName(
        'customer_required_attributes',
        ['tenant_id', 'customer_id', 'attribute_id'],
        'key',
      ),
    ).on(t.tenantId, t.customerId, t.attributeId),
    check('customer_required_attributes_min_level_check', sql`${t.minLevel} >= 0`),
  ],
).enableRLS();

/**
 * 顧客 × スタッフの相性(手入力・訪問後の評価から)。is_ng は絶対に割り当てない(score とは独立)。
 * 担当の実績(履歴)は visits から都度数えるため保存しない。
 */
export const customerStaffAffinities = pgTable(
  'customer_staff_affinities',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    staffId: uuid().notNull(),
    score: smallint().notNull().default(0),
    isNg: boolean().notNull().default(false),
    source: text({ enum: AFFINITY_SOURCES }).notNull().default('manual'),
    noteEnc: bytea(),
    updatedBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('customer_staff_affinities', t),
    tenantRef('customer_staff_affinities', 'customer_id', t, t.customerId, customers, 'cascade'),
    tenantRef('customer_staff_affinities', 'staff_id', t, t.staffId, staff, 'cascade'),
    tenantRef('customer_staff_affinities', 'updated_by', t, t.updatedBy, staff),
    unique(
      constraintName('customer_staff_affinities', ['tenant_id', 'customer_id', 'staff_id'], 'key'),
    ).on(t.tenantId, t.customerId, t.staffId),
    index('customer_staff_affinities_tenant_id_staff_id_idx').on(t.tenantId, t.staffId),
    check('customer_staff_affinities_score_check', sql`${t.score} between -2 and 2`),
    check('customer_staff_affinities_source_check', oneOf(t.source, AFFINITY_SOURCES)),
  ],
).enableRLS();

/**
 * 週次の勤務可能枠(テナントのタイムゾーンの壁時計時刻)。同じ曜日・重なる有効期間で時間帯が重なる枠は
 * EXCLUDE で禁止する。日付をまたぐ枠は2行(当日 22:00〜24:00 と翌曜日 00:00〜02:00)に分ける。
 */
export const staffWeeklyAvailability = pgTable(
  'staff_weekly_availability',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    weekday: smallint().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('staff_weekly_availability', t),
    tenantRef('staff_weekly_availability', 'staff_id', t, t.staffId, staff, 'cascade'),
    check('staff_weekly_availability_weekday_check', sql`${t.weekday} between 0 and 6`),
    check('staff_weekly_availability_time_check', sql`${t.startTime} < ${t.endTime}`),
    check(
      'staff_weekly_availability_effective_check',
      sql`${t.effectiveTo} is null or ${t.effectiveFrom} <= ${t.effectiveTo}`,
    ),
  ],
).enableRLS();

/** 日単位・時間帯単位の例外(休み・臨時の勤務)。理由は健康情報を含みうるため暗号化。 */
export const staffAvailabilityExceptions = pgTable(
  'staff_availability_exceptions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    period: tstzrange().notNull(),
    kind: text({ enum: AVAILABILITY_EXCEPTION_KINDS }).notNull(),
    reasonEnc: bytea(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('staff_availability_exceptions', t),
    tenantRef('staff_availability_exceptions', 'staff_id', t, t.staffId, staff, 'cascade'),
    index('staff_availability_exceptions_tenant_id_staff_id_period_idx').using(
      'gist',
      t.tenantId,
      t.staffId,
      t.period,
    ),
    check('staff_availability_exceptions_kind_check', oneOf(t.kind, AVAILABILITY_EXCEPTION_KINDS)),
    check(
      'staff_availability_exceptions_period_check',
      sql`not isempty(${t.period}) and not lower_inf(${t.period}) and not upper_inf(${t.period})`,
    ),
  ],
).enableRLS();

/**
 * スタッフの Google カレンダー。purpose: schedule(予定・出勤簿の元にする予定を読む。スタッフに1つ)/
 * busy(マッチング用の予定あり時間帯だけを読む)。増分同期の状態も持つ。認証情報は置かない。
 */
export const staffCalendars = pgTable(
  'staff_calendars',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    calendarId: text().notNull(),
    purpose: text({ enum: CALENDAR_PURPOSES }).notNull(),
    syncToken: text(),
    lastSyncedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('staff_calendars', t),
    tenantRef('staff_calendars', 'staff_id', t, t.staffId, staff, 'cascade'),
    unique(constraintName('staff_calendars', ['tenant_id', 'staff_id', 'calendar_id', 'purpose'], 'key')).on(
      t.tenantId,
      t.staffId,
      t.calendarId,
      t.purpose,
    ),
    uniqueIndex('staff_calendars_tenant_id_staff_id_schedule_key')
      .on(t.tenantId, t.staffId)
      .where(sql`purpose = 'schedule'`),
    check('staff_calendars_purpose_check', oneOf(t.purpose, CALENDAR_PURPOSES)),
  ],
).enableRLS();

/**
 * 予定あり時間帯のキャッシュ(Google Calendar の free/busy・手入力)。予定のタイトル・場所は保存しない。
 * 本アプリが作った予定は external_event_id で見分けて除外する(カレンダーへの書き込みを実装した時に使う)。
 */
export const staffBusyBlocks = pgTable(
  'staff_busy_blocks',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    period: tstzrange().notNull(),
    source: text({ enum: BUSY_BLOCK_SOURCES }).notNull(),
    externalEventId: text(),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('staff_busy_blocks', t),
    tenantRef('staff_busy_blocks', 'staff_id', t, t.staffId, staff, 'cascade'),
    index('staff_busy_blocks_tenant_id_staff_id_period_idx').using('gist', t.tenantId, t.staffId, t.period),
    unique(
      constraintName('staff_busy_blocks', ['tenant_id', 'staff_id', 'source', 'external_event_id'], 'key'),
    ).on(t.tenantId, t.staffId, t.source, t.externalEventId),
    check('staff_busy_blocks_source_check', oneOf(t.source, BUSY_BLOCK_SOURCES)),
    check(
      'staff_busy_blocks_period_check',
      sql`not isempty(${t.period}) and not lower_inf(${t.period}) and not upper_inf(${t.period})`,
    ),
  ],
).enableRLS();

/** 担当エリア(テナントが定義する参照テーブル)。geo_cells は geohash の接頭辞の一覧。 */
export const serviceAreas = pgTable(
  'service_areas',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text().notNull(),
    geoCells: text().array().notNull().default(sql`'{}'::text[]`),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [...tenantScoped('service_areas', t), unique('service_areas_tenant_id_name_key').on(t.tenantId, t.name)],
).enableRLS();

export const staffServiceAreas = pgTable(
  'staff_service_areas',
  {
    tenantId: tenantIdColumn(),
    staffId: uuid().notNull(),
    serviceAreaId: uuid().notNull(),
    priority: smallint().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'staff_service_areas_pkey', columns: [t.tenantId, t.staffId, t.serviceAreaId] }),
    tenantFk('staff_service_areas', t),
    tenantIsolation(),
    tenantRef('staff_service_areas', 'staff_id', t, t.staffId, staff, 'cascade'),
    tenantRef('staff_service_areas', 'service_area_id', t, t.serviceAreaId, serviceAreas, 'cascade'),
  ],
).enableRLS();

/**
 * 区画(geohash)間の移動時間のキャッシュ(テーブルのみ。使う処理は未実装)。depart_bucket は出発時刻の区分
 * (週の中の時間 0〜167)。テナントごとに持つ(移動手段の設定・契約上のデータの分離のため)。
 */
export const travelTimeCache = pgTable(
  'travel_time_cache',
  {
    tenantId: tenantIdColumn(),
    originCell: text().notNull(),
    destCell: text().notNull(),
    mode: text({ enum: TRAVEL_MODES }).notNull(),
    departBucket: smallint().notNull(),
    minutes: integer().notNull(),
    meters: integer().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'travel_time_cache_pkey',
      columns: [t.tenantId, t.originCell, t.destCell, t.mode, t.departBucket],
    }),
    tenantFk('travel_time_cache', t),
    tenantIsolation(),
    check('travel_time_cache_mode_check', oneOf(t.mode, TRAVEL_MODES)),
    check('travel_time_cache_depart_bucket_check', sql`${t.departBucket} between 0 and 167`),
  ],
).enableRLS();

/** マッチングの実行(入力を params に丸ごと残し、同じ入力で再現・監査できるようにする)。 */
export const matchingRuns = pgTable(
  'matching_runs',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    requestedBy: uuid(),
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: text({ enum: MATCHING_RUN_STATUSES }).notNull().default('queued'),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    resultSummary: jsonb().$type<Record<string, unknown>>(),
    lastError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('matching_runs', t),
    tenantRef('matching_runs', 'requested_by', t, t.requestedBy, staff),
    index('matching_runs_tenant_id_created_at_idx').on(t.tenantId, t.createdAt),
    check('matching_runs_status_check', oneOf(t.status, MATCHING_RUN_STATUSES)),
  ],
).enableRLS();

/** 実行時の候補(予約 × スタッフ)のスコアの内訳。保存期間は90日(ワーカーの掃除ジョブが消す)。 */
export const matchingRunCandidates = pgTable(
  'matching_run_candidates',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    runId: uuid().notNull(),
    reservationId: uuid().notNull(),
    staffId: uuid().notNull(),
    isFeasible: boolean().notNull().default(true),
    score: numeric({ precision: 8, scale: 3 }),
    breakdown: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    rank: integer(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('matching_run_candidates', t),
    tenantRef('matching_run_candidates', 'run_id', t, t.runId, matchingRuns, 'cascade'),
    tenantRef('matching_run_candidates', 'reservation_id', t, t.reservationId, reservations, 'cascade'),
    tenantRef('matching_run_candidates', 'staff_id', t, t.staffId, staff, 'cascade'),
    unique(
      constraintName(
        'matching_run_candidates',
        ['tenant_id', 'run_id', 'reservation_id', 'staff_id'],
        'key',
      ),
    ).on(t.tenantId, t.runId, t.reservationId, t.staffId),
    index('matching_run_candidates_created_at_idx').on(t.createdAt),
    check('matching_run_candidates_rank_check', sql`${t.rank} >= 1`),
  ],
).enableRLS();
