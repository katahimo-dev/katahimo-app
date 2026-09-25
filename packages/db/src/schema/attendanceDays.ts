import { sql } from 'drizzle-orm';
import {
  date,
  foreignKey,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
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
  ],
).enableRLS();
