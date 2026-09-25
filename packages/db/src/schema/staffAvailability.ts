import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tstzrange } from './_types';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * スタッフの週次の勤務可能時間帯(「毎週月曜 9:00〜17:00 は働ける」)。doc/10。
 *
 * - weekday: 0=日曜〜6=土曜(JavaScriptのDate#getDay()・PostgreSQLのextract(dow)と同じ)。
 * - start_time/end_time: テナントのタイムゾーン(tenants.timezone)での壁時計時刻。
 *   日付を跨ぐ枠(22:00〜翌2:00等)は1行では表現せず、当日の22:00〜24:00(PostgreSQLのtimeは
 *   '24:00'を許容する)と翌曜日の00:00〜02:00の2行に分けて登録する(CHECK start_time < end_time)。
 * - 同じ曜日に複数行を持てる(午前・午後で分かれる等)。
 * - effective_from/effective_to: 有効期間(シフト体系の変更履歴を残すため)。effective_toはnull=無期限、
 *   値がある場合はその日を含む(閉区間)。ある日付に適用する行は
 *   effective_from <= 日付 AND (effective_to IS NULL OR 日付 <= effective_to)。
 */
export const staffWeeklyAvailability = pgTable(
  'staff_weekly_availability',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    weekday: smallint().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    effectiveFrom: date().notNull(),
    effectiveTo: date(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    index('staff_weekly_availability_tenant_staff_idx').on(t.tenantId, t.staffId, t.weekday),
    unique('staff_weekly_availability_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'staff_weekly_availability_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('staff_weekly_availability_weekday_check', sql`${t.weekday} between 0 and 6`),
    check('staff_weekly_availability_time_check', sql`${t.startTime} < ${t.endTime}`),
    check(
      'staff_weekly_availability_effective_check',
      sql`${t.effectiveTo} is null or ${t.effectiveFrom} <= ${t.effectiveTo}`,
    ),
  ],
).enableRLS();

/** 例外の種類。unavailable=休み・私用(週次枠より優先して不可)、extra_available=臨時で追加勤務可。 */
export const AVAILABILITY_EXCEPTION_KINDS = ['unavailable', 'extra_available'] as const;
export type AvailabilityExceptionKind = (typeof AVAILABILITY_EXCEPTION_KINDS)[number];

/**
 * 週次の勤務可能時間帯に対する日単位・時間帯単位の例外(有給・通院・臨時シフト等)。
 *
 * period は tstzrange(半開区間)。終日の休みはその日の 00:00〜翌00:00(テナントのタイムゾーン)で表す。
 * reason は健康状態等の要配慮情報を含みうる自由記述のため暗号化する(doc/09 第1.3節)。
 */
export const staffAvailabilityExceptions = pgTable(
  'staff_availability_exceptions',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    period: tstzrange().notNull(),
    kind: text({ enum: AVAILABILITY_EXCEPTION_KINDS }).notNull(),
    reasonCiphertext: text(),
    reasonKeyVersion: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // 「期間 && 対象時間帯」の重なり検索用(btree_gist拡張が必要。0000_initial_schema.sqlの先頭で作成)。
    index('staff_availability_exceptions_period_gist_idx').using('gist', t.tenantId, t.staffId, t.period),
    foreignKey({
      name: 'staff_availability_exceptions_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // 現時点で複合FKの参照元は無いが、テナントスコープの全テーブルで揃えておく。
    unique('staff_availability_exceptions_tenant_id_uk').on(t.tenantId, t.id),
    check('staff_availability_exceptions_kind_check', sql`${t.kind} in ('unavailable', 'extra_available')`),
    check(
      'staff_availability_exceptions_period_check',
      sql`not isempty(${t.period}) and lower_inf(${t.period}) = false and upper_inf(${t.period}) = false`,
    ),
  ],
).enableRLS();
