import { adminSettingsResponseSchema, saveSettingsResponseSchema } from '@katahimo/shared';
import { api } from './client';

/** 管理者設定API(doc/04_API仕様.md 2.8)。 */
export const settingsApi = {
  get: (signal?: AbortSignal) =>
    api.get('/api/settings/admin', adminSettingsResponseSchema, undefined, { signal }),
  saveGeminiApiKey: (apiKey: string) =>
    api.post('/api/settings/admin/gemini-key', saveSettingsResponseSchema, { apiKey }),
  saveGchatWebhooks: (reportWebhookUrl: string, receiptWebhookUrl: string) =>
    api.post('/api/settings/admin/gchat-webhooks', saveSettingsResponseSchema, {
      reportWebhookUrl,
      receiptWebhookUrl,
    }),
};
