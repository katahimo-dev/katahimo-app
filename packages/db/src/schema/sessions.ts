import { sql } from 'drizzle-orm';
import { foreignKey, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * ログインセッション。GAS版はセッショントークンをStaffシートの列に平文で保持していたが、
 * 新実装はhttpOnly Cookieでトークンを配布し、DBには生トークンではなくSHA-256ハッシュだけを
 * 保存する(DBダンプが漏れても、そのままではCookieに使える値を得られない)。
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    /** 生トークンのSHA-256(hex)。生トークン自体はクライアントのCookieにのみ存在する。 */
    tokenHash: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('sessions_token_hash_idx').on(t.tokenHash),
    // dailyReports.tsと同じ理由。他テナントのstaffId宛にセッションが誤発行される事態を防ぐ。
    foreignKey({
      name: 'sessions_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
  ],
).enableRLS();
