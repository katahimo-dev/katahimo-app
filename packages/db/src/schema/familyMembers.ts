import { sql } from 'drizzle-orm';
import { foreignKey, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { tenants } from './tenants';

/**
 * 世帯構成員(子ども・配偶者等)。GAS版の「家族DB_New」シートに対応。
 *
 * RESERVA CSVの「世帯全員の情報」欄(自由記述)を parseFamilyInfo() で構造化した結果を
 * そのまま保存する(packages/core/src/domain/legacyImport/parseFamilyInfo.ts)。
 * 氏名・生年月日・職業/アレルギー等の付帯情報は全て個人特定につながるため暗号化する。
 * 現時点で世帯構成員を検索する要件は無いため、blindIndexは持たない。
 */
export const familyMembers = pgTable(
  'family_members',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),

    nameCiphertext: text().notNull(),
    nameKeyVersion: integer().notNull(),

    /** 生年月日(normalizeDateStrで正規化済みの "YYYY/M/D" 形式)。未取得の場合は空文字のこともある。 */
    dobCiphertext: text(),
    dobKeyVersion: integer(),

    /** 職業・アレルギー・その他共有事項などの自由記述(parseFamilyInfoのinfo)。 */
    infoCiphertext: text(),
    infoKeyVersion: integer(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    // dailyReports.tsと同じ理由。
    foreignKey({
      name: 'family_members_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
  ],
).enableRLS();
