import { sql } from 'drizzle-orm';
import { foreignKey, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
  },
  (t) => [
    pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING }),
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
