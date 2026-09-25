import {
  adminSettingsResponseSchema,
  listGeminiModelsResponseSchema,
  saveSettingsResponseSchema,
} from '@katahimo/shared';
import { api } from './client';

/** 管理者設定API(doc/api/auth-reports-settings.md「管理者設定 /api/settings/admin」)。 */
export const settingsApi = {
  get: (signal?: AbortSignal) =>
    api.get('/api/settings/admin', adminSettingsResponseSchema, undefined, { signal }),
  saveGeminiApiKey: (apiKey: string) =>
    api.post('/api/settings/admin/gemini-key', saveSettingsResponseSchema, { apiKey }),
  saveGeminiModels: (reportModel: string, ocrModel: string) =>
    api.post('/api/settings/admin/gemini-models', saveSettingsResponseSchema, { reportModel, ocrModel }),
  saveGchatWebhooks: (reportWebhookUrl: string, receiptWebhookUrl: string) =>
    api.post('/api/settings/admin/gchat-webhooks', saveSettingsResponseSchema, {
      reportWebhookUrl,
      receiptWebhookUrl,
    }),
  /** apiKeyが空ならサーバーが保存済みのキーを使う(GAS版 listAvailableGeminiModelsForAdmin と同じ)。 */
  listAvailableModels: (apiKey: string) =>
    api.post('/api/settings/admin/gemini-models/available', listGeminiModelsResponseSchema, {
      apiKey: apiKey || undefined,
    }),
};
