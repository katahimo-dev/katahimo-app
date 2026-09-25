import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { customers } from './customers';
import { staff } from './staff';
import { tenants } from './tenants';

/**
 * 領収書登録。GAS版のMain.js processReceiptImages/uploadReceiptsOnly(領収書ログスプレッドシート
 * IMAGE_LOG_SS_ID + Driveフォルダ RECEIPT_FOLDER_ID)に対応。
 *
 * receiptTimestampはOCRで読み取った領収書日時(無ければ登録時刻にフォールバック)で、
 * attendance_daysのbusinessDateと同様に日時そのものは検索/表示に使うため平文で持つ。
 * 金額・店舗名・申し送りは自由記述で個人の消費行動が読み取れるため暗号化する。
 *
 * dedupeBlindIndexは「同一スタッフ・同一顧客・同一日時・同一金額・同一店舗名」の重複登録を
 * DBに全件復号せず検出するためのHMAC(GAS版processReceiptImagesのbuildKeyと同じ組み合わせを
 * 正規化してブラインドインデックス化したもの)。金額または店舗名が空の場合はGAS版と同様に
 * 重複判定自体を行わないためnullになる。
 *
 * fileKeyはStoragePort(領収書画像の実体。ローカル開発はファイルシステム、本番はGCS想定)の
 * 保存キー。GAS版のDriveアップロードに相当するが、正の保存先はオブジェクトストレージ側に変わる。
 *
 * 【アップロード単位(バッチ)】GAS版は1回のアップロード操作(複数画像)に対して申し送りを1つだけ
 * 入力する。これを表すため、1回の操作で登録した行に同じupload_batch_id(アプリが操作ごとに
 * 採番するUUID)を付け、申し送り(handoff_text)はバッチ内の先頭行(receipt_timestamp→id順で最初の行)
 * にのみ保存し、他の行はnullにする。バッチ用の親テーブルは作らない(バッチ自体に持たせたい属性が
 * 申し送り以外に無く、行単位のミラー書き込み・重複判定の既存設計をそのまま使えるため)。
 * 単票登録や移行データはupload_batch_id=nullでよい。
 */
export const receipts = pgTable(
  'receipts',
  {
    id: uuid().primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid()
      .notNull()
      .references(() => tenants.id),
    staffId: uuid().notNull(),
    /** 顧客に紐付かない経費領収書(駐車場代等)もあり得るためnull許容。 */
    customerId: uuid(),
    /**
     * 顧客マスタに未登録のお客様(GAS版の「未登録のお客様」)の領収書で、スタッフが入力した氏名。
     * customer_idがある場合はnull。氏名は平文方針(doc/09 第1.3節)に従い平文で持つ。
     */
    customerNameText: text(),
    /** 1回のアップロード操作(複数画像)を束ねるID。上記コメント参照。 */
    uploadBatchId: uuid(),

    receiptTimestamp: timestamp({ withTimezone: true }).notNull(),
    dedupeBlindIndex: text(),

    amountCiphertext: text(),
    amountKeyVersion: integer(),
    storeNameCiphertext: text(),
    storeNameKeyVersion: integer(),
    handoffTextCiphertext: text(),
    handoffTextKeyVersion: integer(),

    fileKey: text().notNull(),
    contentType: text().notNull(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
    unique('receipts_tenant_id_uk').on(t.tenantId, t.id),
    // 重複登録検出(findExistingDedupeIndexes)用。
    index('receipts_tenant_dedupe_idx').on(t.tenantId, t.dedupeBlindIndex),
    index('receipts_tenant_upload_batch_idx').on(t.tenantId, t.uploadBatchId),
    // dailyReports.tsと同じ理由。customerIdがnullの行はPostgreSQLのMATCH SIMPLE(既定)により
    // FK制約の対象外になる(顧客に紐付かない経費領収書を許容する仕様と両立する)。
    foreignKey({
      name: 'receipts_tenant_staff_fk',
      columns: [t.tenantId, t.staffId],
      foreignColumns: [staff.tenantId, staff.id],
    }),
    foreignKey({
      name: 'receipts_tenant_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }),
  ],
).enableRLS();
