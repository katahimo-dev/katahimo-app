import { sql } from 'drizzle-orm';
import { foreignKey, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 保育日報。GAS版の「日報」シート(REPORT_SHEET_NAME)に対応(Main.js saveReport/getCustomerReports)。
 *
 * occurredAtは訪問日時(reportDate+startTimeから算出。GAS版のTimestamp列と同じ)で、履歴の並び替え・
 * 絞り込みに使うためciphertextにはせず平文で持つ(単なる日時であり、attendance_daysのbusinessDateと
 * 同様の扱い)。PSI/ES評価も検索/集計に使わないが小さな数値なので平文。自由記述(開始/終了時刻の文脈、
 * メモ・社内向け/保護者向けレポート本文)は個人の生活状況が色濃く出るため、attendance_daysのrowDataと
 * 同じ考え方でJSONにまとめて1本のciphertextに暗号化する(フィールド単位の検索が不要なため)。
 */
export const dailyReports = pgTable(
  'daily_reports',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    customerId: uuid().notNull(),

    occurredAt: timestamp({ withTimezone: true }).notNull(),
    /** PSI評価(1〜5)。未評価はnull(2026-08-28のGAS版仕様変更で未評価に戻せるようにしたのを踏襲)。 */
    riskRating: integer(),
    /** 満足度(ES)評価(1〜5)。未評価はnull。 */
    esRating: integer(),

    contentCiphertext: text().notNull(),
    contentKeyVersion: integer().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // (tenant_id, staff_id)/(tenant_id, customer_id)の複合FK。RLSはSELECTしか絞り込まず、
    // FK制約自体はRLSをバイパスするため、単一列FKのままだとテナントAのstaffId/customerIdに
    // 別テナントの行が混入してもDBが検知できない(データベース構造レビューで発見)。
    foreignKey({
      name: 'daily_reports_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'daily_reports_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
  ],
).enableRLS();
