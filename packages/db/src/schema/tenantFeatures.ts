import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { tenants } from './tenants';

/**
 * テナント単位の機能フラグ(doc/07 第4.2節、doc/10)。
 *
 * 業種(tenants.business_type)や契約プランによって使う機能が異なる場合に、スキーマや
 * コードを分岐させずにここで有効/無効を切り替える。行が無い機能は「既定値」(アプリ側で
 * 機能ごとに定義)として扱う。例: feature_key='staff_matching'(スタッフ自動割当)、
 * 'google_calendar_busy_sync'(Googleカレンダーの空き時間同期)。
 * config には機能固有の設定(例: マッチングの重み係数の上書き)を置く。秘密情報(APIキー等)は
 * 平文になるためここに置かない(app_settingsの暗号化列を使う)。
 */
export const tenantFeatures = pgTable(
  'tenant_features',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    featureKey: text().notNull(),
    enabled: boolean().notNull().default(false),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('tenant_features_tenant_feature_key_idx').on(t.tenantId, t.featureKey),
    unique('tenant_features_tenant_id_uk').on(t.tenantId, t.id),
  ],
).enableRLS();
