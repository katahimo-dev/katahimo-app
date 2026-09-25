import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tstzrange } from './_types';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * マッチング(スタッフ自動割当)の実行記録(doc/10)。
 *
 * 管理者が「来週分の予約にスタッフを割り当てて」と実行するたびに1行作る。params には
 * 対象期間・対象予約ID・スコアの重み等、実行時の入力を丸ごと残す(同じ入力で再現・監査できるように)。
 * result_summary には割当件数・未割当件数・未割当理由の集計等を置く。
 * 個々の候補スコアは matching_run_candidates に持つ。
 */
export const MATCHING_RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type MatchingRunStatus = (typeof MATCHING_RUN_STATUSES)[number];

export const matchingRuns = pgTable(
  'matching_runs',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    /** 実行した管理者。定期実行(システム起動)の場合はnull。 */
    requestedByStaffId: uuid(),
    params: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    status: text({ enum: MATCHING_RUN_STATUSES }).notNull().default('queued'),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    resultSummary: jsonb().$type<Record<string, unknown>>(),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('matching_runs_tenant_id_uk').on(t.tenantId, t.id),
    index('matching_runs_tenant_created_idx').on(t.tenantId, t.createdAt),
    foreignKey({
      name: 'matching_runs_tenant_requested_by_fk',
      columns: [t.tenantId, t.requestedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check(
      'matching_runs_status_check',
      sql`${t.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
    ),
  ],
).enableRLS();

/**
 * 予約の状態。
 * requested=顧客から依頼を受けた(担当未定)、tentative=仮押さえ(割当案あり・未確定)、
 * confirmed=確定、cancelled=キャンセル、done=訪問完了(実績はvisits等、将来の別テーブル)。
 */
export const RESERVATION_STATUSES = ['requested', 'tentative', 'confirmed', 'cancelled', 'done'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * 予約(訪問の需要=「いつ・どの顧客に・何人のスタッフが必要か」)。doc/07 第5章。
 *
 * 予定(reservations)と実績(将来のvisits)を分離する方針に従い、ここには予定のみを持つ。
 * - scheduled_period: 訪問予定の時間帯(tstzrange、半開区間)。
 * - business_date: 業務日(テナントのタイムゾーンでの日付)。出勤簿・日次集計との突合に使う。
 * - external_source/external_id: Googleカレンダー・RESERVA等の外部予定との対応付け。
 *   氏名の文字列一致ではなくIDで追跡する(doc/07 第5章)。手動登録はどちらもnull。
 * - address: 訪問先住所(customersの住所と異なる場合のみ。customersと同じく平文)。
 * - notes: 自由記述のため暗号化する。
 */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    status: text({ enum: RESERVATION_STATUSES }).notNull().default('requested'),
    scheduledPeriod: tstzrange().notNull(),
    businessDate: date().notNull(),
    requiredStaffCount: smallint().notNull().default(1),
    /** サービス種別(例: 'babysitting' / 'housekeeping'、将来 'home_nursing')。テナントごとに自由。 */
    serviceType: text(),
    address: text(),
    notesCiphertext: text(),
    notesKeyVersion: integer(),
    externalSource: text(),
    externalId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('reservations_tenant_id_uk').on(t.tenantId, t.id),
    uniqueIndex('reservations_tenant_external_idx').on(t.tenantId, t.externalSource, t.externalId),
    index('reservations_tenant_business_date_idx').on(t.tenantId, t.businessDate),
    index('reservations_tenant_customer_idx').on(t.tenantId, t.customerId),
    foreignKey({
      name: 'reservations_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    check(
      'reservations_status_check',
      sql`${t.status} in ('requested', 'tentative', 'confirmed', 'cancelled', 'done')`,
    ),
    check('reservations_required_staff_count_check', sql`${t.requiredStaffCount} >= 1`),
    check(
      'reservations_scheduled_period_check',
      sql`not isempty(${t.scheduledPeriod}) and lower_inf(${t.scheduledPeriod}) = false and upper_inf(${t.scheduledPeriod}) = false`,
    ),
  ],
).enableRLS();

/** 割当の状態。proposed=マッチングによる提案(未確定)、confirmed=確定、cancelled=取消。 */
export const ASSIGNMENT_STATUSES = ['proposed', 'confirmed', 'cancelled'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/**
 * 予約へのスタッフ割当(予約1件にrequired_staff_count人まで)。doc/07 第5章。
 *
 * - period: そのスタッフが拘束される時間帯。通常は予約のscheduled_periodと同じだが、
 *   複数人のうち1人だけ途中合流する等に備えて割当ごとに持つ。
 * - スタッフの二重予約は、cancelled以外の行について (tenant_id, staff_id, period) の重なりを
 *   禁止する EXCLUDE USING gist 制約(reservation_assignments_no_staff_double_booking)で
 *   DBが構造的に防ぐ。Drizzle(drizzle-kit)はEXCLUDE制約を表現できないため、手書きの
 *   マイグレーション(0001_custom_constraints.sql)で定義している。
 *   proposed(提案)も対象に含めるため、確定前の提案同士でも同じスタッフの時間帯は重ならない。
 * - match_score/match_reasons: マッチングが付けたスコアと根拠(内訳)。手動割当ではnull。
 */
export const reservationAssignments = pgTable(
  'reservation_assignments',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    reservationId: uuid().notNull(),
    staffId: uuid().notNull(),
    period: tstzrange().notNull(),
    status: text({ enum: ASSIGNMENT_STATUSES }).notNull().default('proposed'),
    matchScore: numeric({ precision: 8, scale: 3 }),
    matchReasons: jsonb().$type<Record<string, unknown>>(),
    /** この割当を生んだマッチング実行。手動割当はnull。 */
    matchingRunId: uuid(),
    /** 割当(または確定)した管理者。マッチングの自動提案のみの段階ではnull。 */
    assignedByStaffId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('reservation_assignments_tenant_id_uk').on(t.tenantId, t.id),
    index('reservation_assignments_tenant_reservation_idx').on(t.tenantId, t.reservationId),
    // 同じ予約に同じスタッフを有効な状態で2重に割り当てない(取消済みの行は履歴として何行でも残せる)。
    uniqueIndex('reservation_assignments_active_staff_idx')
      .on(t.tenantId, t.reservationId, t.staffId)
      .where(sql`status <> 'cancelled'`),
    foreignKey({
      name: 'reservation_assignments_tenant_reservation_fk',
      columns: [t.tenantId, t.reservationId],
      foreignColumns: [reservations.tenantId, reservations.id],
    }),
    foreignKey({
      name: 'reservation_assignments_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'reservation_assignments_tenant_matching_run_fk',
      columns: [t.tenantId, t.matchingRunId],
      foreignColumns: [matchingRuns.tenantId, matchingRuns.id],
    }),
    foreignKey({
      name: 'reservation_assignments_tenant_assigned_by_fk',
      columns: [t.tenantId, t.assignedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('reservation_assignments_status_check', sql`${t.status} in ('proposed', 'confirmed', 'cancelled')`),
    check(
      'reservation_assignments_period_check',
      sql`not isempty(${t.period}) and lower_inf(${t.period}) = false and upper_inf(${t.period}) = false`,
    ),
  ],
).enableRLS();

/**
 * マッチング実行時の候補(予約×スタッフ)ごとのスコア内訳。
 *
 * 「なぜこのスタッフが選ばれた/選ばれなかったか」を管理者に説明するためのもの。
 * is_feasible=falseはハード制約で除外された候補で、breakdown.excludedBy に除外理由
 * (例: 'ng' / 'busy' / 'outside_availability' / 'missing_required_attribute')を入れる。
 * rankは実現可能な候補内での順位(1が最良)、除外候補はnull。
 */
export const matchingRunCandidates = pgTable(
  'matching_run_candidates',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    matchingRunId: uuid().notNull(),
    reservationId: uuid().notNull(),
    staffId: uuid().notNull(),
    isFeasible: boolean().notNull().default(true),
    score: numeric({ precision: 8, scale: 3 }),
    breakdown: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    rank: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('matching_run_candidates_tenant_id_uk').on(t.tenantId, t.id),
    uniqueIndex('matching_run_candidates_run_reservation_staff_idx').on(
      t.tenantId,
      t.matchingRunId,
      t.reservationId,
      t.staffId,
    ),
    foreignKey({
      name: 'matching_run_candidates_tenant_run_fk',
      columns: [t.tenantId, t.matchingRunId],
      foreignColumns: [matchingRuns.tenantId, matchingRuns.id],
    }),
    foreignKey({
      name: 'matching_run_candidates_tenant_reservation_fk',
      columns: [t.tenantId, t.reservationId],
      foreignColumns: [reservations.tenantId, reservations.id],
    }),
    foreignKey({
      name: 'matching_run_candidates_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('matching_run_candidates_rank_check', sql`${t.rank} is null or ${t.rank} >= 1`),
  ],
).enableRLS();
