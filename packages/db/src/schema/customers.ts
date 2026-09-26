import { ADDRESS_KINDS, ARCHIVE_REASONS, CUSTOMER_SOURCES, GENDERS } from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  constraintName,
  createdAt,
  idColumn,
  latLngCheck,
  oneOf,
  rowVersion,
  tenantIdColumn,
  updatedAt,
} from './_columns';
import { tenantFk, tenantIsolation, tenantRef, tenantScoped } from './_helpers';
import { daterange } from './_types';
import { serviceItems } from './services';
import { importRuns } from './tenancy';

/**
 * 顧客(利用世帯)。memo は自由記述、benefit_member_id は他システムの会員ID、evacuation_site は避難場所。
 * 住所は customer_addresses、連絡先(第三者)は customer_contacts、
 * 子ども(サービスの対象者)は care_recipients、取込元固有の項目は customer_source_records に分ける。
 * 取込元から消えた顧客・手動で外した顧客は archived_at(+理由)。個人情報の消去依頼は purged_at。
 */
export const customers = pgTable(
  'customers',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    displayName: text().notNull(),
    /** 苗字(正規化済み。空白を除いた NFKC)。苗字検索の索引に使う。 */
    familyName: text().notNull(),
    givenName: text().notNull().default(''),
    familyNameKana: text(),
    givenNameKana: text(),
    email: text(),
    phone: text(),
    memo: text(),
    benefitMemberId: text(),
    evacuationSite: text(),
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    archivedAt: timestamp({ withTimezone: true }),
    archiveReason: text({ enum: ARCHIVE_REASONS }),
    purgedAt: timestamp({ withTimezone: true }),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('customers', t),
    index('customers_tenant_id_family_name_idx').on(t.tenantId, t.familyName),
    index('customers_tenant_id_family_name_kana_idx').on(
      t.tenantId,
      sql`${t.familyNameKana} text_pattern_ops`,
    ),
    check('customers_archive_reason_check', oneOf(t.archiveReason, ARCHIVE_REASONS)),
    check('customers_archived_check', sql`(${t.archivedAt} is null) = (${t.archiveReason} is null)`),
  ],
).enableRLS();

/**
 * 取込元の顧客レコードとの対応((source, external_id) で一意)。RESERVA 固有の項目(会員種別・会費の
 * 支払方法/状況・性別・年代等)は attributes(jsonb、個人を特定しない分類値だけ)に置く。
 */
export const customerSourceRecords = pgTable(
  'customer_source_records',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    source: text({ enum: CUSTOMER_SOURCES }).notNull(),
    externalId: text().notNull(),
    attributes: jsonb().$type<Record<string, string>>().notNull().default({}),
    externalRegisteredAt: timestamp({ withTimezone: true }),
    externalUpdatedAt: timestamp({ withTimezone: true }),
    lastImportRunId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('customer_source_records', t),
    tenantRef('customer_source_records', 'customer_id', t, t.customerId, customers, 'cascade'),
    tenantRef('customer_source_records', 'last_import_run_id', t, t.lastImportRunId, importRuns),
    unique(constraintName('customer_source_records', ['tenant_id', 'source', 'external_id'], 'key')).on(
      t.tenantId,
      t.source,
      t.externalId,
    ),
    index('customer_source_records_tenant_id_customer_id_idx').on(t.tenantId, t.customerId),
    check('customer_source_records_source_check', oneOf(t.source, CUSTOMER_SOURCES)),
  ],
).enableRLS();

/**
 * 住所。kind: home(自宅。期間の重なる自宅は EXCLUDE で禁止)/ secondary(単身赴任先等の期間限定の住所、
 * GAS版の「住所2」)/ visit(訪問先が自宅以外の場合)。address_line は取込元の住所文字列のまま
 * (prefecture・city は検索・絞り込み用に取り出した値)。緯度経度は lat / lng(ルート計算に使う)、粗い区画
 * (geohash 6文字)は geo_cell。
 * valid は `[開始日, 終了日の翌日)`(無期限は上限なし)。
 */
export const customerAddresses = pgTable(
  'customer_addresses',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    kind: text({ enum: ADDRESS_KINDS }).notNull(),
    postalCode: text(),
    prefecture: text(),
    city: text(),
    addressLine: text().notNull(),
    building: text(),
    parkingArea: text(),
    parkingDetail: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    geoCell: text(),
    valid: daterange().notNull().default(sql`'(,)'::daterange`),
    isPrimary: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('customer_addresses', t),
    tenantRef('customer_addresses', 'customer_id', t, t.customerId, customers, 'cascade'),
    index('customer_addresses_tenant_id_customer_id_idx').on(t.tenantId, t.customerId),
    index('customer_addresses_tenant_id_city_idx').on(t.tenantId, t.city),
    uniqueIndex('customer_addresses_tenant_id_customer_id_primary_key')
      .on(t.tenantId, t.customerId)
      .where(sql`is_primary`),
    check('customer_addresses_kind_check', oneOf(t.kind, ADDRESS_KINDS)),
    check('customer_addresses_valid_check', sql`not isempty(${t.valid})`),
    check('customer_addresses_geo_cell_check', sql`${t.geoCell} ~ '^[0-9b-hjkmnp-z]{6}$'`),
    latLngCheck('customer_addresses_lat_lng_check', t.lat, t.lng),
  ],
).enableRLS();

/** 連絡先(緊急連絡先等。本人ではない第三者)。relation は「父」等の続柄。 */
export const customerContacts = pgTable(
  'customer_contacts',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    relation: text(),
    name: text(),
    phone: text(),
    notes: text(),
    isEmergency: boolean().notNull().default(false),
    sortOrder: smallint().notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('customer_contacts', t),
    tenantRef('customer_contacts', 'customer_id', t, t.customerId, customers, 'cascade'),
    index('customer_contacts_tenant_id_customer_id_idx').on(t.tenantId, t.customerId),
  ],
).enableRLS();

/**
 * サービスの対象者(子ども)。allergy はアレルギー(健康情報)、needs は配慮事項・付帯情報の自由記述。
 * 取込は差分で行い(IDを保つ)、取込元から消えた子どもは archived_at。
 */
export const careRecipients = pgTable(
  'care_recipients',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    name: text().notNull(),
    nameKana: text(),
    birthDate: date(),
    sex: text({ enum: GENDERS }),
    allergy: text(),
    needs: text(),
    sortOrder: smallint().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('care_recipients', t),
    tenantRef('care_recipients', 'customer_id', t, t.customerId, customers, 'cascade'),
    index('care_recipients_tenant_id_customer_id_idx').on(t.tenantId, t.customerId),
    check('care_recipients_sex_check', oneOf(t.sex, GENDERS)),
  ],
).enableRLS();

/** 定期利用の枠(毎週◯曜日の◯時〜◯時)。壁時計時刻はテナントのタイムゾーン。 */
export const customerRecurringSlots = pgTable(
  'customer_recurring_slots',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    customerId: uuid().notNull(),
    weekday: smallint().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    valid: daterange().notNull().default(sql`'(,)'::daterange`),
    serviceItemId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('customer_recurring_slots', t),
    tenantRef('customer_recurring_slots', 'customer_id', t, t.customerId, customers, 'cascade'),
    tenantRef('customer_recurring_slots', 'service_item_id', t, t.serviceItemId, serviceItems),
    index('customer_recurring_slots_tenant_id_customer_id_idx').on(t.tenantId, t.customerId),
    check('customer_recurring_slots_weekday_check', sql`${t.weekday} between 0 and 6`),
    check('customer_recurring_slots_time_check', sql`${t.startTime} < ${t.endTime}`),
  ],
).enableRLS();

/** 顧客の希望(1顧客1行)。性別の希望は gender_is_hard でハード制約かどうかを決める。 */
export const customerPreferences = pgTable(
  'customer_preferences',
  {
    tenantId: tenantIdColumn(),
    customerId: uuid().notNull(),
    preferredStaffGender: text({ enum: GENDERS }),
    genderIsHard: boolean().notNull().default(false),
    notes: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'customer_preferences_pkey', columns: [t.tenantId, t.customerId] }),
    tenantFk('customer_preferences', t),
    tenantIsolation(),
    tenantRef('customer_preferences', 'customer_id', t, t.customerId, customers, 'cascade'),
    check('customer_preferences_preferred_staff_gender_check', oneOf(t.preferredStaffGender, GENDERS)),
  ],
).enableRLS();
