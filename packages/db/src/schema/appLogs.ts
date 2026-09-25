import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { staff } from './staff';
import { tenants } from './tenants';

/** ログレベル。SECURITYはログイン失敗・権限外アクセス等のセキュリティイベント(GAS版Logger.jsと同じ区分)。 */
export const APP_LOG_LEVELS = ['INFO', 'WARN', 'ERROR', 'SECURITY'] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];

/**
 * アプリの操作ログ・監査ログ(GAS版Logger.jsのバッファ→Drive CSVに相当)。追記専用。
 *
 * - tenant_id: ログイン前のイベント(テナント特定前のログイン失敗等)はnull。
 * - action: 操作の識別子(例: 'auth.login_failed'、'report.daily.create')。
 * - actor_staff_id: 操作したスタッフ。target_staff_id: 管理者が他スタッフのデータを操作した場合の対象。
 * - details: 付加情報。個人情報・本文(日報の内容等)は入れない(IDと件数程度に留める)。
 *
 * 【RLS】他テーブルと異なり操作別にポリシーを分けている。
 * - SELECT/DELETE: 自テナントの行のみ(tenant_idがnullの行はアプリからは見えない。運用者がオーナー
 *   ロールで参照する)。DELETEは保存期間を過ぎた行の削除用のポリシーだが、アプリロールのDELETE権限は
 *   0003_app_role_privileges.sql でREVOKEしており、削除は運用者が所有者ロールで行う。
 * - INSERT: 自テナントの行、またはtenant_id=nullの行(ログイン前)。
 * - UPDATE: ポリシーを作らない(=RLSにより常に0行)うえ、マイグレーションでアプリロールのUPDATE
 *   権限自体をREVOKEしている(0001_custom_constraints.sql)。
 */
export const appLogs = pgTable(
  'app_logs',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid().references(() => tenants.id),
    level: text({ enum: APP_LOG_LEVELS }).notNull(),
    action: text().notNull(),
    actorStaffId: uuid(),
    targetStaffId: uuid(),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    userAgent: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('app_logs_select', { for: 'select', using: TENANT_RLS_USING }),
    pgPolicy('app_logs_delete', { for: 'delete', using: TENANT_RLS_USING }),
    pgPolicy('app_logs_insert', {
      for: 'insert',
      withCheck: sql`tenant_id is null or ${TENANT_RLS_USING}`,
    }),
    index('app_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
    // tenant_idがnullの行はMATCH SIMPLEによりFK検査の対象外になる。
    foreignKey({
      name: 'app_logs_tenant_actor_fk',
      columns: [t.tenantId, t.actorStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'app_logs_tenant_target_fk',
      columns: [t.tenantId, t.targetStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('app_logs_level_check', sql`${t.level} in ('INFO', 'WARN', 'ERROR', 'SECURITY')`),
  ],
).enableRLS();
