import { BUSINESS_TYPES, TENANT_LIFECYCLE_EVENTS, TENANT_STATUSES } from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { constraintName, createdAt, idColumn, oneOf, updatedAt } from './_columns';
import { bytea } from './_types';

/**
 * platform スキーマ: テナントを横断する運営側のデータ(RLS なし)。アプリロールは参照だけ
 * (レート制限のカウンタを除く)。テナントの作成は SECURITY DEFINER の platform.provision_tenant()
 * (0001_baseline_custom.sql)で行う。
 */
export const platform = pgSchema('platform');

/** 料金プラン(請求は未実装。機能の既定値の束として使う)。 */
export const plans = platform.table(
  'plans',
  {
    id: idColumn().primaryKey(),
    code: text().notNull(),
    name: text().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('plans_code_key').on(t.code)],
);

/** プランごとの機能の既定値。テナント単位の上書きは public.tenant_features。 */
export const planFeatures = platform.table(
  'plan_features',
  {
    planId: uuid().notNull(),
    featureKey: text().notNull(),
    enabled: boolean().notNull().default(false),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'plan_features_pkey', columns: [t.planId, t.featureKey] }),
    foreignKey({
      name: 'plan_features_plan_id_fkey',
      columns: [t.planId],
      foreignColumns: [plans.id],
    }).onDelete('cascade'),
  ],
);

/**
 * テナント(法人)。ログインは slug でテナントを特定してから、そのテナントの RLS の中でスタッフを探す
 * (全テナントを横断してメールアドレスを探さない)。
 * - status: provisioning(作成中)→ active → suspended(利用停止。ログイン・API を拒否)→
 *   terminating(解約手続き中)→ terminated(解約済み。purge_after を過ぎたら消去)。
 * - timezone: 業務日の境界・壁時計時刻(出勤簿の時刻・勤務可能時間帯)の解釈に使う IANA 名。
 */
export const tenants = platform.table(
  'tenants',
  {
    id: idColumn().primaryKey(),
    slug: text().notNull(),
    name: text().notNull(),
    status: text({ enum: TENANT_STATUSES }).notNull().default('provisioning'),
    timezone: text().notNull().default('Asia/Tokyo'),
    businessType: text({ enum: BUSINESS_TYPES }).notNull().default('babysitting'),
    planId: uuid(),
    /**
     * カレンダーの設定(運用担当者だけが `pnpm tenant:calendars` で変える。アプリは読むだけ):
     * `{ sharedCalendars: [{ calendarId, ownerName? }], allowedStaffCalendars: ['id@example.com' | '@example.co.jp'] }`。
     * スタッフの予定を読むカレンダーは allowedStaffCalendars に合うものだけ(core/domain/schedule/calendarPolicy.ts)。
     */
    calendarSettings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    terminatedAt: timestamp({ withTimezone: true }),
    purgeAfter: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('tenants_slug_key').on(t.slug),
    foreignKey({ name: 'tenants_plan_id_fkey', columns: [t.planId], foreignColumns: [plans.id] }),
    check('tenants_status_check', oneOf(t.status, TENANT_STATUSES)),
    check('tenants_business_type_check', oneOf(t.businessType, BUSINESS_TYPES)),
    check('tenants_slug_check', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}$'`),
    check('tenants_terminated_at_check', sql`${t.status} <> 'terminated' or ${t.terminatedAt} is not null`),
  ],
);

/** 運営者(横断の調査・テナント作成を行う人)。現時点では台帳のみ(ログイン機能は無い)。 */
export const platformOperators = platform.table(
  'platform_operators',
  {
    id: idColumn().primaryKey(),
    email: text().notNull(),
    displayName: text().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('platform_operators_email_key').on(t.email)],
);

/**
 * レート制限・一時ロックのカウンタ(テナントを特定する前にも使うため RLS なし)。1行 = 規則 × 対象。
 * subject_hash は対象(IPアドレス・`slug:ログインID`・スタッフID)の HMAC-SHA256。個人情報を平文で持たない。
 */
export const rateLimitBuckets = platform.table(
  'rate_limit_buckets',
  {
    rule: text().notNull(),
    subjectHash: bytea().notNull(),
    windowStart: timestamp({ withTimezone: true }).notNull(),
    hits: integer().notNull(),
    blockedUntil: timestamp({ withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'rate_limit_buckets_pkey', columns: [t.rule, t.subjectHash] }),
    index('rate_limit_buckets_updated_at_idx').on(t.updatedAt),
    check('rate_limit_buckets_hits_check', sql`${t.hits} >= 0`),
  ],
);

/**
 * テナントの状態遷移の記録(追記のみ)。テナントを消去した後も証跡として残すため tenants への FK は持たない。
 */
export const tenantLifecycleEvents = platform.table(
  'tenant_lifecycle_events',
  {
    id: idColumn().primaryKey(),
    tenantId: uuid().notNull(),
    event: text({ enum: TENANT_LIFECYCLE_EVENTS }).notNull(),
    actor: text().notNull(),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index(constraintName('tenant_lifecycle_events', ['tenant_id', 'created_at'], 'idx')).on(
      t.tenantId,
      t.createdAt,
    ),
    check('tenant_lifecycle_events_event_check', oneOf(t.event, TENANT_LIFECYCLE_EVENTS)),
  ],
);
