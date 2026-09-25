import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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
import { tenants } from './tenants';

/**
 * スタッフ(社員)。認証情報(パスワードハッシュ)を兼ねる。
 *
 * 氏名・メール・電話は平文で保持する(2026-08のデータベース構造レビューを踏まえ、要配慮性の
 * 低い通常の個人情報はフィールド暗号化の対象から外し、DB/バックアップの透過的暗号化(TDE)+
 * Row Level Security+アクセス制御に委ねる方針へ変更。doc/09参照)。emailはログイン時の検索キー
 * になるため、書き込み時に`normalizeEmailForIndex`で正規化した値を保存する(表記ゆれで
 * ログインできなくなることを防ぐため)。
 *
 * 【マッチング用プロフィール(2026-09追加、doc/10)】gender〜calendarIdは、将来の
 * 「顧客へのスタッフ最適割当」アプリが制約・スコア計算に使う属性。既存スタッフは全てnullの
 * まま動作し、null項目は「制約なし/不明」として扱う。特技・資格などテナントごとに増減する
 * 属性は列にせず staff_attributes(attributes.ts)に持つ。
 */
export const staff = pgTable(
  'staff',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    name: text().notNull(),
    email: text().notNull(),
    /**
     * 2つ目のログイン用メールアドレス(GAS版Staffシートの「サブメール」に相当)。emailと同じく
     * normalizeEmailForIndexで正規化した値を保存する。テナント内で一意(null以外)。
     * 「あるスタッフのemailと別スタッフのalt_emailが同じ」という列を跨いだ重複はUNIQUE制約では
     * 表現できないため、登録・更新時にアプリ側(usecase)で両列を検索して防ぐ。
     */
    altEmail: text(),
    phone: text(),

    /**
     * argon2id。GAS版から移行したスタッフは初回ログインまでnull(legacyPasswordHashのみ持つ)。
     * ログイン成功時にサイレント再ハッシュしてここへ設定する(packages/core/src/usecases/auth.ts)。
     */
    passwordHash: text(),
    /**
     * GAS版のSHA-256+salt方式のハッシュ(sha256(password + AUTH_SALT))。移行直後の
     * スタッフのみ持ち、argon2idへの再ハッシュが完了したらnullに戻す。新規登録スタッフは
     * 最初からargon2idのみでこの列は使わない。
     */
    legacyPasswordHash: text(),

    isAdmin: boolean().notNull().default(false),
    retirementDate: date(),

    // ── マッチング用プロフィール(すべて任意) ──
    /** 性別(customers.genderと同じく分類情報として平文。例: 'female' / 'male' / 'other')。 */
    gender: text(),
    /** 生まれ年。年齢層の条件判定に足りる粒度に留め、生年月日そのものは持たない。 */
    birthYear: smallint(),
    /** 雇用形態(例: 'full_time' / 'part_time' / 'contractor')。 */
    employmentType: text(),
    /** 1日あたりの最大訪問件数(ハード制約)。nullは上限なし。 */
    maxVisitsPerDay: smallint(),
    /** 週あたりの最大稼働分数(ハード制約)。nullは上限なし。 */
    maxWeeklyMinutes: integer(),
    /** 居住エリア(市区町村レベル、平文)。粗い距離の事前絞り込みに使う。 */
    homeArea: text(),
    /** 自宅の緯度経度。customers.latLngと同じく正確な位置情報のため暗号化する。 */
    homeLatLngCiphertext: text(),
    homeLatLngKeyVersion: integer(),
    /** 主な移動手段。移動時間の見積もり(Routes APIのtravelMode)に使う。 */
    travelMode: text({ enum: ['car', 'bicycle', 'transit', 'walk'] }),
    /** 空き時間(free/busy)取得に使うGoogleカレンダーID。通常は本人のGoogleアカウントのメール。 */
    calendarId: text(),
    /** テナント独自の表示・検索用項目(doc/07 第4.2節)。業務ロジックの本体データは置かない。 */
    customFields: jsonb().$type<Record<string, unknown>>().notNull().default({}),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('staff_tenant_email_idx').on(t.tenantId, t.email),
    uniqueIndex('staff_tenant_alt_email_idx').on(t.tenantId, t.altEmail).where(sql`alt_email is not null`),
    // attendance_days/daily_reports等からの複合外部キー(tenant_id, staff_id)の参照先。
    // customers.ts の customers_tenant_id_uk と同じ理由(RLSはFK制約をバイパスするため)。
    unique('staff_tenant_id_uk').on(t.tenantId, t.id),
    check(
      'staff_travel_mode_check',
      sql`${t.travelMode} is null or ${t.travelMode} in ('car', 'bicycle', 'transit', 'walk')`,
    ),
    check('staff_max_visits_per_day_check', sql`${t.maxVisitsPerDay} is null or ${t.maxVisitsPerDay} >= 0`),
    check('staff_max_weekly_minutes_check', sql`${t.maxWeeklyMinutes} is null or ${t.maxWeeklyMinutes} >= 0`),
  ],
).enableRLS();
