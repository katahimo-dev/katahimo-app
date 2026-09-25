import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
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
import { staff } from './staff';
import { tenants } from './tenants';

/** 属性カテゴリ。特技・資格・性格/特性・対応言語・その他。 */
export const ATTRIBUTE_CATEGORIES = ['skill', 'qualification', 'trait', 'language', 'other'] as const;
export type AttributeCategory = (typeof ATTRIBUTE_CATEGORIES)[number];

/**
 * 値の型。boolean=持っている/いない、level=習熟度(1〜max_level)、text=自由な短い値(例: 言語名)。
 */
export const ATTRIBUTE_VALUE_TYPES = ['boolean', 'level', 'text'] as const;
export type AttributeValueType = (typeof ATTRIBUTE_VALUE_TYPES)[number];

/**
 * スタッフ属性の定義(カタログ)。テナントごとに自由に定義する(doc/10)。
 *
 * 特技(ピアノ・英語・料理…)や資格(保育士・看護師・普通自動車免許…)は法人・業種ごとに
 * 全く異なるため、staffの列として固定せずこのカタログ+staff_attributesの縦持ちにする。
 * 将来の訪問看護テナントでも同じ仕組みで「看護師免許」「精神科訪問看護の経験」等を表せる。
 * 顧客側の必須条件(customer_required_attributes)もこの定義を参照する。
 *
 * 定義を消すと過去の割当理由(match_reasons)が辿れなくなるため物理削除はせず、
 * archived_at を立てて新規選択肢から外すソフトデリートとする。
 */
export const attributeDefinitions = pgTable(
  'attribute_definitions',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    category: text({ enum: ATTRIBUTE_CATEGORIES }).notNull(),
    /** プログラムから参照する安定したキー(例: 'piano', 'nursery_teacher_license')。テナント内で一意。 */
    key: text().notNull(),
    /** 画面表示名(例: "ピアノ")。 */
    label: text().notNull(),
    valueType: text({ enum: ATTRIBUTE_VALUE_TYPES }).notNull().default('boolean'),
    /** value_type='level' の場合の最大レベル(例: 5)。それ以外はnull。 */
    maxLevel: smallint(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('attribute_definitions_tenant_key_idx').on(t.tenantId, t.key),
    // staff_attributes/customer_required_attributesからの複合FKの参照先(customers.tsと同じ理由)。
    unique('attribute_definitions_tenant_id_uk').on(t.tenantId, t.id),
    check(
      'attribute_definitions_category_check',
      sql`${t.category} in ('skill', 'qualification', 'trait', 'language', 'other')`,
    ),
    check('attribute_definitions_value_type_check', sql`${t.valueType} in ('boolean', 'level', 'text')`),
    check('attribute_definitions_max_level_check', sql`${t.maxLevel} is null or ${t.maxLevel} >= 1`),
  ],
).enableRLS();

/**
 * スタッフが持つ属性(スタッフ × 属性定義)。1スタッフ1属性につき1行。
 *
 * - level: value_type='level'のときの習熟度。マッチングのソフトスコア(高いほど加点)に使う。
 * - value_text: value_type='text'のときの値(例: 言語属性の"英語(日常会話)")。短い分類値のため平文。
 * - expires_on: 資格の有効期限(例: 普通救命講習の修了証)。期限切れの資格はハード制約を満たさない扱い。
 * - note: 自由記述のため、customers.memoと同じ方針で暗号化する(doc/09 第1.3節)。
 */
export const staffAttributes = pgTable(
  'staff_attributes',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    attributeDefinitionId: uuid().notNull(),
    level: smallint(),
    valueText: text(),
    expiresOn: date(),
    noteCiphertext: text(),
    noteKeyVersion: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('staff_attributes_tenant_staff_attr_idx').on(t.tenantId, t.staffId, t.attributeDefinitionId),
    // 「この属性を持つスタッフ」の逆引き(マッチングのハード制約の絞り込み)用。
    index('staff_attributes_tenant_attr_idx').on(t.tenantId, t.attributeDefinitionId),
    unique('staff_attributes_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'staff_attributes_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'staff_attributes_tenant_attr_def_fk',
      columns: [t.tenantId, t.attributeDefinitionId],
      foreignColumns: [attributeDefinitions.tenantId, attributeDefinitions.id],
    }),
    check('staff_attributes_level_check', sql`${t.level} is null or ${t.level} >= 0`),
  ],
).enableRLS();
