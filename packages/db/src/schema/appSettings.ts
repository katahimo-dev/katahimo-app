import { integer, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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

    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [pgPolicy('tenant_isolation', { for: 'all', using: TENANT_RLS_USING, withCheck: TENANT_RLS_USING })],
).enableRLS();
