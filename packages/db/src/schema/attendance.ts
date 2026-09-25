import {
  ATTENDANCE_DAY_STATUSES,
  ATTENDANCE_PERIOD_STATUSES,
  TRAVEL_LEG_KINDS,
  VISIT_SOURCES,
  VISIT_STATUSES,
  WEATHER_CODES,
  WORK_SEGMENT_KINDS,
} from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
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
import { customers } from './customers';
import { reservationAssignments } from './services';
import { staff } from './staff';

/**
 * 勤怠(出勤簿)は、1日の入れ物 attendance_days と、その日の実体 visits(訪問)・work_segments(事務作業等)・
 * travel_legs(移動)に分けて持つ。出勤簿スプレッドシートの列(C/D/E…)との対応は
 * packages/core/src/domain/attendance/sheetLayout.ts の projectDay / applyRowEdit だけが知っている。
 *
 * 各実体の overridden_fields は「カレンダー反映の後に人が手で変えた項目」の意味の名前
 * (例: 'label', 'actual_start')。スプレッドシートの強調表示(changed_fields)はここから作る。
 * 時刻の範囲は `[開始, 終了)`。開始・終了の片方しか入力されていない場合は片側が無限の範囲になる。
 */

/** 1日の入れ物。その日の実体が変わるたびに row_version を上げる(楽観的排他の単位)。 */
export const attendanceDays = pgTable(
  'attendance_days',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    businessDate: date().notNull(),
    shoppingErrandCount: smallint(),
    remarksEnc: bytea(),
    status: text({ enum: ATTENDANCE_DAY_STATUSES }).notNull().default('open'),
    overriddenFields: text().array().notNull().default(sql`'{}'::text[]`),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('attendance_days', t),
    tenantRef('attendance_days', 'staff_id', t, t.staffId, staff),
    unique(constraintName('attendance_days', ['tenant_id', 'staff_id', 'business_date'], 'key')).on(
      t.tenantId,
      t.staffId,
      t.businessDate,
    ),
    check('attendance_days_status_check', oneOf(t.status, ATTENDANCE_DAY_STATUSES)),
    check('attendance_days_shopping_errand_count_check', sql`${t.shoppingErrandCount} >= 0`),
  ],
).enableRLS();

/**
 * 訪問(実績)。seq はその日の中での並び(1〜3 が出勤簿の訪問#1〜#3。4件目以降も保存するが出勤簿には出ない)。
 * 顧客が特定できない予定(カレンダーのタイトルだけ)は customer_id を null にし、表示名を label_enc に持つ。
 * 同じスタッフの取消以外の訪問の実績の時間帯の重なりは EXCLUDE で禁止(0001_baseline_custom.sql)。
 */
export const visits = pgTable(
  'visits',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    customerId: uuid(),
    assignmentId: uuid(),
    businessDate: date().notNull(),
    seq: smallint().notNull(),
    plannedPeriod: tstzrange(),
    actualPeriod: tstzrange(),
    status: text({ enum: VISIT_STATUSES }).notNull().default('scheduled'),
    source: text({ enum: VISIT_SOURCES }).notNull(),
    externalEventId: text(),
    labelEnc: bytea(),
    overriddenFields: text().array().notNull().default(sql`'{}'::text[]`),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('visits', t),
    tenantRef('visits', 'staff_id', t, t.staffId, staff),
    tenantRef('visits', 'customer_id', t, t.customerId, customers),
    tenantRef('visits', 'assignment_id', t, t.assignmentId, reservationAssignments),
    unique(constraintName('visits', ['tenant_id', 'staff_id', 'business_date', 'seq'], 'key')).on(
      t.tenantId,
      t.staffId,
      t.businessDate,
      t.seq,
    ),
    unique(constraintName('visits', ['tenant_id', 'staff_id', 'external_event_id'], 'key')).on(
      t.tenantId,
      t.staffId,
      t.externalEventId,
    ),
    index('visits_tenant_id_customer_id_business_date_idx').on(t.tenantId, t.customerId, t.businessDate),
    check('visits_status_check', oneOf(t.status, VISIT_STATUSES)),
    check('visits_source_check', oneOf(t.source, VISIT_SOURCES)),
    check('visits_seq_check', sql`${t.seq} >= 1`),
    check('visits_actual_period_check', sql`not isempty(${t.actualPeriod})`),
    check('visits_planned_period_check', sql`not isempty(${t.plannedPeriod})`),
  ],
).enableRLS();

/** 訪問以外の業務時間(事務作業・研修等)。seq 1〜2 が出勤簿の作業1・2。内容は自由記述のため暗号化。 */
export const workSegments = pgTable(
  'work_segments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    businessDate: date().notNull(),
    seq: smallint().notNull(),
    kind: text({ enum: WORK_SEGMENT_KINDS }).notNull().default('office'),
    period: tstzrange(),
    descriptionEnc: bytea(),
    overriddenFields: text().array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('work_segments', t),
    tenantRef('work_segments', 'staff_id', t, t.staffId, staff),
    unique(constraintName('work_segments', ['tenant_id', 'staff_id', 'business_date', 'seq'], 'key')).on(
      t.tenantId,
      t.staffId,
      t.businessDate,
      t.seq,
    ),
    check('work_segments_kind_check', oneOf(t.kind, WORK_SEGMENT_KINDS)),
    check('work_segments_seq_check', sql`${t.seq} >= 1`),
    check('work_segments_period_check', sql`not isempty(${t.period})`),
  ],
).enableRLS();

/**
 * 移動。kind: commute(自宅→最初の訪問)/ between(訪問の間。seq 1 = #1→#2、2 = #2→#3)/ return(最後の訪問→自宅)。
 * from/to の訪問への参照は訪問が消えたら null にする(ON DELETE SET NULL (列) は drizzle-kit で書けないため
 * 0001_baseline_custom.sql で定義)。
 */
export const travelLegs = pgTable(
  'travel_legs',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    businessDate: date().notNull(),
    kind: text({ enum: TRAVEL_LEG_KINDS }).notNull(),
    seq: smallint().notNull().default(1),
    fromVisitId: uuid(),
    toVisitId: uuid(),
    plannedMinutes: integer(),
    distanceKm: numeric({ precision: 6, scale: 2 }),
    weather: text({ enum: WEATHER_CODES }),
    overriddenFields: text().array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('travel_legs', t),
    tenantRef('travel_legs', 'staff_id', t, t.staffId, staff),
    unique(
      constraintName('travel_legs', ['tenant_id', 'staff_id', 'business_date', 'kind', 'seq'], 'key'),
    ).on(t.tenantId, t.staffId, t.businessDate, t.kind, t.seq),
    check('travel_legs_kind_check', oneOf(t.kind, TRAVEL_LEG_KINDS)),
    check('travel_legs_weather_check', oneOf(t.weather, WEATHER_CODES)),
    check('travel_legs_planned_minutes_check', sql`${t.plannedMinutes} >= 0`),
    check('travel_legs_distance_km_check', sql`${t.distanceKm} >= 0`),
    check('travel_legs_seq_check', sql`${t.seq} >= 1`),
  ],
).enableRLS();

/**
 * 月の締め(スタッフ × 月)。locked の月の勤怠は、アプリの判定に加えてトリガー
 * (enforce_attendance_period_lock、0001_baseline_custom.sql)でも書き換えを拒否する。
 */
export const attendancePeriods = pgTable(
  'attendance_periods',
  {
    tenantId: tenantIdColumn(),
    staffId: uuid().notNull(),
    yearMonth: text().notNull(),
    status: text({ enum: ATTENDANCE_PERIOD_STATUSES }).notNull().default('open'),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'attendance_periods_pkey', columns: [t.tenantId, t.staffId, t.yearMonth] }),
    tenantFk('attendance_periods', t),
    tenantIsolation(),
    tenantRef('attendance_periods', 'staff_id', t, t.staffId, staff, 'cascade'),
    tenantRef('attendance_periods', 'locked_by', t, t.lockedBy, staff),
    check('attendance_periods_status_check', oneOf(t.status, ATTENDANCE_PERIOD_STATUSES)),
    check('attendance_periods_year_month_check', sql`${t.yearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'attendance_periods_locked_check',
      sql`(${t.status} = 'locked') = (${t.lockedAt} is not null)`,
    ),
  ],
).enableRLS();
