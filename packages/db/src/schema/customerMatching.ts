import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { attributeDefinitions } from './attributes';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 希望する時間帯(customer_preferences.preferred_time_windows の要素)。
 * weekday: 0=日曜〜6=土曜、start/end: "HH:MM"(テナントのタイムゾーンの壁時計時刻)。
 */
export interface PreferredTimeWindow {
  weekday: number;
  start: string;
  end: string;
}

/**
 * 顧客のスタッフ割当に関する希望条件(1顧客1行、doc/10)。
 *
 * - preferred_staff_gender: 希望するスタッフの性別(staff.genderと同じ値)。nullは指定なし。
 *   gender_is_hard=trueならハード制約(満たさないスタッフは候補から除外)、falseならソフトスコアの加点のみ。
 * - preferred_weekdays / preferred_time_windows: 定期利用の希望曜日・時間帯。予約(reservations)が
 *   まだ無い段階での「この顧客を担当できそうなスタッフ」の事前検討に使う。個々の予約の時間帯は
 *   reservations.scheduled_period を正とする。
 * - notes: 自由記述のため暗号化(doc/09 第1.3節)。
 *
 * 必須の属性(「保育士資格必須」等)は customer_required_attributes に行として持つ。
 */
export const customerPreferences = pgTable(
  'customer_preferences',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    preferredStaffGender: text(),
    genderIsHard: boolean().notNull().default(false),
    /** 0=日曜〜6=土曜の配列。 */
    preferredWeekdays: jsonb().$type<number[]>().notNull().default([]),
    preferredTimeWindows: jsonb().$type<PreferredTimeWindow[]>().notNull().default([]),
    notesCiphertext: text(),
    notesKeyVersion: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('customer_preferences_tenant_customer_idx').on(t.tenantId, t.customerId),
    unique('customer_preferences_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'customer_preferences_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
  ],
).enableRLS();

/**
 * 顧客が担当スタッフに求める属性(例: 「保育士資格」「英語レベル3以上」)。
 *
 * is_hard=trueはハード制約(属性を持たない/min_level未満のスタッフは除外)、falseは
 * ソフトスコアの加点(「できればピアノが弾ける人」)。
 */
export const customerRequiredAttributes = pgTable(
  'customer_required_attributes',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    attributeDefinitionId: uuid().notNull(),
    /** value_type='level'の属性で要求する最低レベル。nullは「持っていればよい」。 */
    minLevel: smallint(),
    isHard: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('customer_required_attributes_tenant_customer_attr_idx').on(
      t.tenantId,
      t.customerId,
      t.attributeDefinitionId,
    ),
    unique('customer_required_attributes_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'customer_required_attributes_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'customer_required_attributes_tenant_attr_def_fk',
      columns: [t.tenantId, t.attributeDefinitionId],
      foreignColumns: [attributeDefinitions.tenantId, attributeDefinitions.id],
    }),
    check('customer_required_attributes_min_level_check', sql`${t.minLevel} is null or ${t.minLevel} >= 0`),
  ],
).enableRLS();

/** 相性情報の出所。manual=管理者の手入力、feedback=顧客/スタッフの評価、history=過去の訪問実績からの自動算出。 */
export const AFFINITY_SOURCES = ['manual', 'feedback', 'history'] as const;
export type AffinitySource = (typeof AFFINITY_SOURCES)[number];

/**
 * 顧客×スタッフの相性(doc/10)。
 *
 * - score: -2(相性が悪い)〜+2(とても良い)、0が中立。マッチングのソフトスコアに使う。
 * - is_ng: trueならNG(このスタッフを絶対に割り当てない)。ハード制約。scoreとは独立に持つ
 *   (「相性は普通だが家庭の事情でNG」等を表せるように)。
 * - note: 自由記述(NG理由等、要配慮性が高い)のため暗号化する。
 * - updated_by_staff_id: 最後に更新した管理者。source='history'の自動算出ではnull。
 */
export const customerStaffAffinities = pgTable(
  'customer_staff_affinities',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    customerId: uuid().notNull(),
    staffId: uuid().notNull(),
    score: smallint().notNull().default(0),
    isNg: boolean().notNull().default(false),
    source: text({ enum: AFFINITY_SOURCES }).notNull().default('manual'),
    noteCiphertext: text(),
    noteKeyVersion: integer(),
    updatedByStaffId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('customer_staff_affinities_tenant_customer_staff_idx').on(
      t.tenantId,
      t.customerId,
      t.staffId,
    ),
    // スタッフ側からの逆引き(「このスタッフがNGの顧客一覧」)用。
    index('customer_staff_affinities_tenant_staff_idx').on(t.tenantId, t.staffId),
    unique('customer_staff_affinities_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'customer_staff_affinities_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
    foreignKey({
      name: 'customer_staff_affinities_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    // updated_by_staff_idがnullの行はMATCH SIMPLEによりFK検査の対象外になる(receiptsのcustomer_idと同じ)。
    foreignKey({
      name: 'customer_staff_affinities_tenant_updated_by_fk',
      columns: [t.tenantId, t.updatedByStaffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    check('customer_staff_affinities_score_check', sql`${t.score} between -2 and 2`),
    check('customer_staff_affinities_source_check', sql`${t.source} in ('manual', 'feedback', 'history')`),
  ],
).enableRLS();
