import type {
  AppSettingsPatchInput,
  AppSettingsRecord,
  AppSettingsRepositoryPort,
} from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { appSettings } from '../schema';

type AppSettingsRow = typeof appSettings.$inferSelect;

function toRecord(row: AppSettingsRow): AppSettingsRecord {
  return {
    tenantId: row.tenantId,
    geminiApiKey:
      row.geminiApiKeyCiphertext != null && row.geminiApiKeyKeyVersion != null
        ? { ciphertext: row.geminiApiKeyCiphertext, keyVersion: row.geminiApiKeyKeyVersion }
        : null,
    geminiReportModel: row.geminiReportModel,
    geminiOcrModel: row.geminiOcrModel,
    gchatReportWebhookUrl:
      row.gchatReportWebhookUrlCiphertext != null && row.gchatReportWebhookUrlKeyVersion != null
        ? { ciphertext: row.gchatReportWebhookUrlCiphertext, keyVersion: row.gchatReportWebhookUrlKeyVersion }
        : null,
    gchatReceiptWebhookUrl:
      row.gchatReceiptWebhookUrlCiphertext != null && row.gchatReceiptWebhookUrlKeyVersion != null
        ? {
            ciphertext: row.gchatReceiptWebhookUrlCiphertext,
            keyVersion: row.gchatReceiptWebhookUrlKeyVersion,
          }
        : null,
  };
}

export class DrizzleAppSettingsRepository implements AppSettingsRepositoryPort {
  constructor(private readonly db: Database) {}

  async find(tenantId: string): Promise<AppSettingsRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(appSettings).where(eq(appSettings.tenantId, tenantId)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async upsert(tenantId: string, patch: AppSettingsPatchInput): Promise<AppSettingsRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const setValues: Partial<typeof appSettings.$inferInsert> = { updatedAt: new Date() };
      if (patch.geminiApiKey !== undefined) {
        setValues.geminiApiKeyCiphertext = patch.geminiApiKey?.ciphertext ?? null;
        setValues.geminiApiKeyKeyVersion = patch.geminiApiKey?.keyVersion ?? null;
      }
      if (patch.geminiReportModel !== undefined) setValues.geminiReportModel = patch.geminiReportModel;
      if (patch.geminiOcrModel !== undefined) setValues.geminiOcrModel = patch.geminiOcrModel;
      if (patch.gchatReportWebhookUrl !== undefined) {
        setValues.gchatReportWebhookUrlCiphertext = patch.gchatReportWebhookUrl?.ciphertext ?? null;
        setValues.gchatReportWebhookUrlKeyVersion = patch.gchatReportWebhookUrl?.keyVersion ?? null;
      }
      if (patch.gchatReceiptWebhookUrl !== undefined) {
        setValues.gchatReceiptWebhookUrlCiphertext = patch.gchatReceiptWebhookUrl?.ciphertext ?? null;
        setValues.gchatReceiptWebhookUrlKeyVersion = patch.gchatReceiptWebhookUrl?.keyVersion ?? null;
      }

      const rows = await tx
        .insert(appSettings)
        .values({ tenantId, ...setValues })
        .onConflictDoUpdate({ target: appSettings.tenantId, set: setValues })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('管理者設定の保存に失敗しました');
      return toRecord(row);
    });
  }
}
