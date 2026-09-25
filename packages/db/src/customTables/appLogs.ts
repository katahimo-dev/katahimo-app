import { index, inet, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * 操作ログ(app_logs)の型の定義。表そのものは月ごとの RANGE パーティション表のため手書きの SQL
 * (drizzle/0001_baseline_custom.sql)で作り、drizzle-kit の差分の対象(src/schema/index.ts)には入れない。
 * 列を変えるときは手書きのマイグレーションとこの定義を両方直す。
 */
export const appLogs = pgTable(
  'app_logs',
  {
    id: uuid().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    tenantId: uuid(),
    level: text({ enum: ['INFO', 'WARN', 'ERROR', 'SECURITY'] }).notNull(),
    action: text().notNull(),
    actorType: text({ enum: ['staff', 'system', 'operator', 'anonymous'] }).notNull(),
    actorId: uuid(),
    targetType: text(),
    targetId: uuid(),
    requestId: text(),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: inet(),
    userAgent: text(),
  },
  (t) => [
    primaryKey({ name: 'app_logs_pkey', columns: [t.createdAt, t.id] }),
    index('app_logs_tenant_id_created_at_idx').on(t.tenantId, t.createdAt),
  ],
);
