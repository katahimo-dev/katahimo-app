import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
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
 * 顧客(利用世帯の代表者)。GAS版の「顧客DB_New」シートに対応。
 *
 * RESERVA(外部予約システム)の顧客CSVを1件も情報を落とさず取り込めるよう、CSVの全列に
 * 対応するカラムを持つ(packages/ingestion の reservaCsv パーサー参照)。
 *
 * 【暗号化方針(2026-08 データベース構造レビューで見直し)】
 * 当初は個人特定につながる項目を全てランダム化暗号(ciphertext+keyVersion)で保存していたが、
 * 「DB個別の暗号化は過剰、バックアップの暗号化で十分」という有識者指摘を踏まえ、対象を
 * 要配慮性の高い項目(第三者情報・位置情報・自由記述・識別子)に絞った(doc/09参照)。
 * - 平文のまま(TDE+RLS+アクセス制御で保護): 氏名・かな・メール・電話・住所・駐車場情報
 * - 引き続き暗号化(ciphertext+keyVersion): 緊急連絡先(第三者情報)・避難場所(通学先を
 *   特定しうる)・メモ(自由記述で内容予測不可)・Benefit会員ID(識別子)・緯度経度(自宅の
 *   正確な位置情報)
 *
 * 唯一の例外: CSVの「パスワード」列(RESERVA側のログインパスワード)は取り込まない。
 * この値は本アプリの認証に一切使わず、他システムの認証情報を不必要に複製する理由がないため
 * (漏洩時の被害範囲を広げるだけになる)。
 *
 * 氏名は「苗字だけで検索する」現場運用があるため、familyName/givenNameを平文で別カラムに持つ
 * (packages/core/src/domain/pii/japaneseName.ts の splitJapaneseFullName で分割し、
 * normalizeStaffNameで正規化済みの値を保存する)。
 * externalSource/externalIdは、氏名の文字列一致ではなく外部システムのIDで顧客を一意に
 * 追跡するためのもの(doc/07 第5章の方針)。取込元に存在しなくなった顧客はdeactivatedAtを
 * 立てるソフトデリートとし、物理削除はしない。
 */
export const customers = pgTable(
  'customers',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),

    /** 取込元システム識別子(例: 'reserva')。手動登録の場合はnull。 */
    externalSource: text(),
    /** 取込元システムでの顧客ID(RESERVA CSVの「顧客ID」列)。 */
    externalId: text(),

    name: text().notNull(),
    /** 苗字だけの完全一致検索用(normalizeStaffNameで正規化済み)。表示にはnameを使う。 */
    familyName: text().notNull(),
    givenName: text().notNull(),

    familyNameKana: text(),
    givenNameKana: text(),

    email: text(),
    phone: text(),

    /** 番地・建物名等、市区町村より詳細な住所。 */
    addressDetail: text(),
    city: text(),

    /** 駐車場(位置)。RESERVA CSVの「駐車場」列。 */
    parkingArea: text(),
    /** 駐車場番号・指定場所の詳細など。 */
    parkingDetail: text(),

    /** 第三者(緊急連絡先本人)の情報のため引き続き暗号化する。 */
    emergencyContactCiphertext: text(),
    emergencyContactKeyVersion: integer(),
    /** 緊急連絡先の方(申請者との関係性)。例: "父"。 */
    emergencyContactRelationCiphertext: text(),
    emergencyContactRelationKeyVersion: integer(),

    /** 災害時の避難場所(最寄りの小中学校)。通学先の特定につながりうるため暗号化する。 */
    evacuationSiteCiphertext: text(),
    evacuationSiteKeyVersion: integer(),

    /** 自由記述で内容が予測できないため暗号化する。 */
    memoCiphertext: text(),
    memoKeyVersion: integer(),

    /** Benefit会員ID。他システムの会員証番号のため、識別子として保守的に暗号化する。 */
    benefitMemberIdCiphertext: text(),
    benefitMemberIdKeyVersion: integer(),

    /** 住所2(単身赴任先等、期間限定の別住所)。 */
    address2: text(),
    address2StartDate: date(),
    address2EndDate: date(),

    /** 緯度・経度。自宅の正確な位置情報のため暗号化する。 */
    latLngCiphertext: text(),
    latLngKeyVersion: integer(),

    // ── 以下は個人特定に直結しない運用・分類情報のため平文で保持する ──
    /** 会員種別(例: Family Sitter 会員)。 */
    memberType: text(),
    /** 会員状況(有効／無効)。 */
    memberStatus: text(),
    /** 会費支払方法(現地決済／銀行振込／口座振替／請求書払い)。 */
    paymentMethod: text(),
    /** 会費支払状況(未払／支払済み)。 */
    paymentStatus: text(),
    /** 性別。 */
    gender: text(),
    /** 年代(例: "30代")。生年月日そのものではなく既に丸められた区分のため平文で扱う。 */
    ageBracket: text(),

    /** RESERVA側の登録日時(CSVのExcelシリアル日時から変換)。 */
    registeredAt: timestamp({ withTimezone: true }),
    /** RESERVA側の最終更新日時。このアプリ内でのupdatedAtとは別物。 */
    externalLastUpdatedAt: timestamp({ withTimezone: true }),

    /** 取込元に存在しなくなった場合に設定するソフトデリートのタイムスタンプ。nullなら有効。 */
    deactivatedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    uniqueIndex('customers_tenant_external_idx').on(t.tenantId, t.externalSource, t.externalId),
    // daily_reports等からの複合外部キー(tenant_id, customer_id)の参照先。RLSはSELECTしか
    // 絞り込まずFK制約はRLSを常にバイパスするため、単一列PKだけでは他テナントのcustomer_idを
    // 誤って参照してもDBが検知できない。この複合UNIQUEにより「そのidが本当にそのtenant_idの
    // 顧客か」をFK制約自体で強制できるようにする。
    unique('customers_tenant_id_uk').on(t.tenantId, t.id),
    // 苗字だけの完全一致検索(searchCustomersByFamilyName)用。同姓の顧客が複数いる前提のため
    // UNIQUEにはしない。
    index('customers_tenant_family_name_idx').on(t.tenantId, t.familyName),
  ],
).enableRLS();
