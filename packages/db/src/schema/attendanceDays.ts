import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 勤怠(出勤簿)の1日分。GAS版の個別出勤簿スプレッドシートの入力列(数式列は含まない)に対応。
 *
 * rowDataは packages/core/src/domain/attendance/types.ts の AttendanceRowData(JSON)を
 * まるごと1つの暗号文として保存する。個々のフィールド(訪問先名等、customers同様に個人特定に
 * つながりうる自由記述を含む)は常に「1日分をまとめて読み書きする」用途しか無く、フィールド単位の
 * 検索が必要ないため、customersのようなフィールドごとのciphertext分割はせず1本にまとめている。
 *
 * 労働時間・残業・移動距離・基準距離超過回数などの派生値は一切保存しない。常に
 * computeDayDerived/computeMonthlyTotals(attendanceCalc.ts)でrowDataから都度計算する
 * (出勤簿テンプレートの数式列に相当。GAS版・webapp-poc版と同じ「入力列だけを保持し
 * 数式は都度計算」という設計をそのまま踏襲する)。
 *
 * rowDataのキーは出勤簿テンプレートの列記号そのもの(C/D/E=#1訪問先/始業/終業、I/R=#1後/#2後の
 * 気象状況、H/Q=計画移動時間、L〜W=#2/#3、X〜AC=事務作業1/2、AG/AH/AI/AJ=移動・出勤・退勤距離、
 * AN=買物代行、AO=備考。packages/core/src/domain/attendance/types.ts)。
 *
 * 【変更セルの強調表示】changed_fieldsは、スケジュール(カレンダー)から自動転記された値に対して
 * スタッフ/管理者が手で変更した列記号の配列(例: ["D","E","AO"])。スプレッドシートへのミラー時に
 * 該当セルを強調表示する(gas-project-3のonEditによるハイライトに相当)。列記号は個人情報を
 * 含まないため平文。誰がいつ何を変えたかの履歴は attendance_day_changes に追記する。
 */
export const attendanceDays = pgTable(
  'attendance_days',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    businessDate: date().notNull(),

    rowDataCiphertext: text().notNull(),
    rowDataKeyVersion: integer().notNull(),

    changedFields: jsonb().$type<string[]>().notNull().default([]),
    /** 最後に変更したスタッフ(本人または管理者)。自動転記のみの行はnull。 */
    lastChangedByStaffId: uuid(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('attendance_days_tenant_staff_date_idx').on(t.tenantId, t.staffId, t.businessDate),
    // dailyReports.tsと同じ理由。給与直結のテーブルのため特に取り違えを防ぐ効果が大きい。
    foreignKey({
      name: 'attendance_days_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'attendance_days_tenant_last_changed_by_fk',
      columns: [t.tenantId, t.lastChangedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    unique('attendance_days_tenant_id_uk').on(t.tenantId, t.id),
  ],
).enableRLS();

/**
 * 勤怠1日分の変更履歴(追記のみ)。給与に直結するため、誰がいつどの列を変えたかを残す。
 *
 * changed_fields: その変更で値が変わった列記号の配列。
 * previous_row_data: 変更前のrowData全体(attendance_days.row_dataと同じ形式の暗号文)。
 * 初回作成時はnull。変更後の値は attendance_days 側(または次の履歴行のprevious)で分かる。
 */
export const attendanceDayChanges = pgTable(
  'attendance_day_changes',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    attendanceDayId: uuid().notNull(),
    /** 変更したスタッフ。システムによる自動転記(夜間バッチ等)はnull。 */
    changedByStaffId: uuid(),
    changedFields: jsonb().$type<string[]>().notNull().default([]),
    previousRowDataCiphertext: text(),
    previousRowDataKeyVersion: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    index('attendance_day_changes_tenant_day_idx').on(t.tenantId, t.attendanceDayId, t.createdAt),
    unique('attendance_day_changes_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'attendance_day_changes_tenant_day_fk',
      columns: [t.tenantId, t.attendanceDayId],
      foreignColumns: [attendanceDays.tenantId, attendanceDays.id],
    }),
    foreignKey({
      name: 'attendance_day_changes_tenant_changed_by_fk',
      columns: [t.tenantId, t.changedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
  ],
).enableRLS();
