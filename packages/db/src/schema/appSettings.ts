import { bigint, integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { TENANT_RLS_USING } from './_rls';
import { tenants } from './tenants';

/**
 * テナント単位の管理者設定。GAS版のScript Properties(GEMINI_API_KEY・
 * GEMINI_MODEL_REPORT/OCR・GCHAT_REPORT_WEBHOOK_URL/GCHAT_RECEIPT_WEBHOOK_URL)に対応する、
 * マルチテナント版の置き場所(1テナント1行、tenantIdがPK)。
 *
 * 未設定の値は.env側のデフォルト(GEMINI_API_KEY等)にフォールバックする
 * (packages/api/src/container.ts参照)。GAS版と同様、APIキー・Webhook URLは
 * 空文字での保存を許さない(packages/core/src/usecases/settings.ts参照)。
 *
 * 顧客CSV取込の状態(GAS版Script PropertiesのLAST_CSV_VERSION/DATA_VERSIONに相当):
 * - customer_csv_last_imported_version: 最後に取り込んだ顧客CSVの版(取込元ファイルの更新日時や
 *   ハッシュ等、取込処理が決める文字列)。同じ版の再取込をスキップする判定に使う。
 * - data_version: 顧客データが更新されるたびに+1する単調増加の版数。クライアント側キャッシュの
 *   無効化判定(GAS版のDATA_VERSION)に使う。
 *
 * 編集可能なAIプロンプト・入力欄プレースホルダーは行数が可変のため ai_prompts(aiPrompts.ts)に持つ。
 */
export const appSettings = pgTable(
  'app_settings',
  {
    tenantId: uuid()
      .primaryKey()
      .references(() => tenants.id),

    geminiApiKeyCiphertext: text(),
    geminiApiKeyKeyVersion: integer(),
    geminiReportModel: text(),
    geminiOcrModel: text(),

    gchatReportWebhookUrlCiphertext: text(),
    gchatReportWebhookUrlKeyVersion: integer(),
    gchatReceiptWebhookUrlCiphertext: text(),
    gchatReceiptWebhookUrlKeyVersion: integer(),

    customerCsvLastImportedVersion: text(),
    customerCsvLastImportedAt: timestamp({ withTimezone: true }),
    dataVersion: bigint({ mode: 'number' }).notNull().default(0),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  () => [pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING })],
).enableRLS();
