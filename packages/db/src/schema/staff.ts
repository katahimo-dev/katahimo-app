import { EMPLOYMENT_TYPES, GENDERS, STAFF_ROLES, TRAVEL_MODES } from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  constraintName,
  createdAt,
  idColumn,
  oneOf,
  rowVersion,
  tenantIdColumn,
  updatedAt,
} from './_columns';
import { tenantFk, tenantIsolation, tenantRef, tenantScoped } from './_helpers';
import { bytea, daterange } from './_types';

/**
 * スタッフ。氏名・かな・電話・自宅住所は平文(TDE・RLS・権限で守る通常の個人情報)、自宅の正確な緯度経度は
 * 暗号化(home_geo_enc)し、粗い区画(geohash 6文字)だけを平文で持つ。認証情報は staff_credentials、
 * ログイン用メールは staff_login_emails に分ける(一覧の問い合わせでパスワードハッシュを読まないため)。
 * 退職は retired_on(この日以降はログイン不可)。雇用条件は staff_employment_terms(期間つき)。
 */
export const staff = pgTable(
  'staff',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** 表示名(カレンダー予定の担当者名の突き合わせにも使う。GAS版スタッフ台帳の氏名)。 */
    displayName: text().notNull(),
    familyName: text().notNull(),
    givenName: text().notNull().default(''),
    familyNameKana: text(),
    givenNameKana: text(),
    phone: text(),
    role: text({ enum: STAFF_ROLES }).notNull().default('staff'),
    retiredOn: date(),
    gender: text({ enum: GENDERS }),
    birthYear: smallint(),
    /** 居住エリア(市区町村程度)。 */
    homeArea: text(),
    /** 自宅住所(出勤・退勤経路の起点。緯度経度が無い場合にジオコーディングする)。 */
    homeAddress: text(),
    homeGeoEnc: bytea(),
    homeGeoCell: text(),
    travelMode: text({ enum: TRAVEL_MODES }),
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('staff', t),
    index('staff_tenant_id_family_name_idx').on(t.tenantId, t.familyName),
    index('staff_tenant_id_family_name_kana_idx').on(t.tenantId, sql`${t.familyNameKana} text_pattern_ops`),
    check('staff_role_check', oneOf(t.role, STAFF_ROLES)),
    check('staff_gender_check', oneOf(t.gender, GENDERS)),
    check('staff_travel_mode_check', oneOf(t.travelMode, TRAVEL_MODES)),
    check('staff_birth_year_check', sql`${t.birthYear} between 1900 and 2100`),
    check('staff_home_geo_cell_check', sql`${t.homeGeoCell} ~ '^[0-9b-hjkmnp-z]{6}$'`),
  ],
).enableRLS();

/**
 * ログインに使えるメールアドレス(正規化済み・小文字)。主キーが (tenant_id, email) のため、あるスタッフの
 * メールと別スタッフのサブメールの重複もDBが拒否する。スタッフごとに主(is_primary)は1つまで。
 */
export const staffLoginEmails = pgTable(
  'staff_login_emails',
  {
    tenantId: tenantIdColumn(),
    email: text().notNull(),
    staffId: uuid().notNull(),
    isPrimary: boolean().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'staff_login_emails_pkey', columns: [t.tenantId, t.email] }),
    tenantFk('staff_login_emails', t),
    tenantIsolation(),
    tenantRef('staff_login_emails', 'staff_id', t, t.staffId, staff, 'cascade'),
    uniqueIndex('staff_login_emails_tenant_id_staff_id_primary_key')
      .on(t.tenantId, t.staffId)
      .where(sql`is_primary`),
    index('staff_login_emails_tenant_id_staff_id_idx').on(t.tenantId, t.staffId),
    check('staff_login_emails_email_check', sql`${t.email} = lower(${t.email}) and ${t.email} like '%@%'`),
  ],
).enableRLS();

/**
 * 認証情報(argon2id)。GAS版から移行したスタッフは初回ログインまで legacy_password_hash だけを持ち、
 * ログイン成功時に argon2id へ移す。ロックの判定は platform.rate_limit_buckets(存在しないアカウントも
 * 同じく数えるため)。failed_count / locked_until は管理者が状況を確かめるための写し。
 */
export const staffCredentials = pgTable(
  'staff_credentials',
  {
    tenantId: tenantIdColumn(),
    staffId: uuid().notNull(),
    passwordHash: text(),
    legacyPasswordHash: text(),
    passwordChangedAt: timestamp({ withTimezone: true }),
    failedCount: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'staff_credentials_pkey', columns: [t.tenantId, t.staffId] }),
    tenantFk('staff_credentials', t),
    tenantIsolation(),
    tenantRef('staff_credentials', 'staff_id', t, t.staffId, staff, 'cascade'),
    check('staff_credentials_failed_count_check', sql`${t.failedCount} >= 0`),
  ],
).enableRLS();

/** 雇用条件(期間つき。期間の重なりは EXCLUDE で禁止)。マッチングのハード制約(上限)に使う。 */
export const staffEmploymentTerms = pgTable(
  'staff_employment_terms',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    valid: daterange().notNull(),
    employmentType: text({ enum: EMPLOYMENT_TYPES }).notNull(),
    maxVisitsPerDay: smallint(),
    maxWeeklyMinutes: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('staff_employment_terms', t),
    tenantRef('staff_employment_terms', 'staff_id', t, t.staffId, staff, 'cascade'),
    check('staff_employment_terms_employment_type_check', oneOf(t.employmentType, EMPLOYMENT_TYPES)),
    check('staff_employment_terms_max_visits_per_day_check', sql`${t.maxVisitsPerDay} >= 0`),
    check('staff_employment_terms_max_weekly_minutes_check', sql`${t.maxWeeklyMinutes} >= 0`),
    check('staff_employment_terms_valid_check', sql`not isempty(${t.valid})`),
  ],
).enableRLS();

/**
 * ログインセッション。生トークンは Cookie にだけあり、DB は SHA-256 だけを持つ。
 * 無操作の期限(idle_expires_at、ローリング延長)とログインからの絶対的な期限(absolute_expires_at)の
 * 早い方で失効する。ログアウト・パスワード変更・退職は revoked_at を付ける(行は保存期間の後に消す)。
 */
export const sessions = pgTable(
  'sessions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    tokenHash: bytea().notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    idleExpiresAt: timestamp({ withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    ip: inet(),
    userAgent: text(),
  },
  (t) => [
    ...tenantScoped('sessions', t),
    tenantRef('sessions', 'staff_id', t, t.staffId, staff, 'cascade'),
    unique('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_tenant_id_staff_id_idx').on(t.tenantId, t.staffId),
    index('sessions_absolute_expires_at_idx').on(t.absoluteExpiresAt),
    check('sessions_expiry_check', sql`${t.idleExpiresAt} <= ${t.absoluteExpiresAt}`),
  ],
).enableRLS();

/**
 * パスワード再設定の確認コード。照合は HMAC(code_hash)だけ。試行回数の加算・使用済みへの遷移は
 * 1文の条件付き UPDATE で原子的に行う。スタッフごとに未使用のコードは1つまで(部分UNIQUE)。
 * mail_code_enc はワーカーがメールを送るまでの間だけ持つ暗号化したコード(送信・使用・期限切れで消す)。
 */
export const passwordResetCodes = pgTable(
  'password_reset_codes',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    codeHash: bytea().notNull(),
    sentToEmail: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    usedAt: timestamp({ withTimezone: true }),
    attemptCount: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    mailCodeEnc: bytea(),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('password_reset_codes', t),
    tenantRef('password_reset_codes', 'staff_id', t, t.staffId, staff, 'cascade'),
    uniqueIndex('password_reset_codes_tenant_id_staff_id_active_key')
      .on(t.tenantId, t.staffId)
      .where(sql`used_at is null`),
    index('password_reset_codes_expires_at_idx').on(t.expiresAt),
    check(
      'password_reset_codes_attempt_count_check',
      sql`${t.attemptCount} between 0 and ${t.maxAttempts}`,
    ),
  ],
).enableRLS();

