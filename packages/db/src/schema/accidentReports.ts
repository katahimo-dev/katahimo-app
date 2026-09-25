import { sql } from 'drizzle-orm';
import { foreignKey, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 事故報告/ヒヤリハット。GAS版の「事故報告」シート(ACCIDENT_SHEET_NAME)に対応
 * (Main.js saveAccidentReport/getCustomerReports)。
 *
 * occurredAtは保存日時(GAS版は常にnew Date()で、訪問日時の指定はできない)。reportTypeは
 * '事故報告'/'ヒヤリハット'の分類でしかないため平文。対象児の氏名・生年月日、発生状況・対応内容など
 * 自由記述の項目は個人の受傷歴・生活状況を含むため、daily_reportsと同じくJSONにまとめて
 * 1本のciphertextに暗号化する。
 */
export const accidentReports = pgTable(
  'accident_reports',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    customerId: uuid().notNull(),

    occurredAt: timestamp({ withTimezone: true }).notNull(),
    /** '事故報告' | 'ヒヤリハット'。GAS版のReportType列と同じ値をそのまま使う。 */
    reportType: text().notNull(),

    contentCiphertext: text().notNull(),
    contentKeyVersion: integer().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // dailyReports.tsと同じ理由(複合FKでテナント跨ぎの取り違えを構造的に防ぐ)。
    foreignKey({
      name: 'accident_reports_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'accident_reports_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
  ],
).enableRLS();
