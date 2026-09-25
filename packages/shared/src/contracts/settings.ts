import { z } from 'zod';

/** GET /api/settings/admin (管理者のみ。閲覧はSECURITYログに記録される) */
export const adminSettingsViewSchema = z.object({
  geminiApiKey: z.string(),
  geminiReportModel: z.string(),
  geminiOcrModel: z.string(),
  gchatReportWebhookUrl: z.string(),
  gchatReceiptWebhookUrl: z.string(),
});
export type AdminSettingsView = z.infer<typeof adminSettingsViewSchema>;
export const adminSettingsResponseSchema = z.object({ settings: adminSettingsViewSchema });

/** 設定保存系の共通レスポンス(変更が無い場合もok=trueで「変更ありません」を返す)。 */
export const saveSettingsResponseSchema = z.object({
  ok: z.literal(true),
  changed: z.boolean(),
  message: z.string(),
});
export type SaveSettingsResponse = z.infer<typeof saveSettingsResponseSchema>;

/** POST /api/settings/admin/gemini-key */
export const saveGeminiApiKeyRequestSchema = z.object({ apiKey: z.string() });
/** POST /api/settings/admin/gemini-models */
export const saveGeminiModelsRequestSchema = z.object({ reportModel: z.string(), ocrModel: z.string() });
/** POST /api/settings/admin/gchat-webhooks */
export const saveGchatWebhooksRequestSchema = z.object({
  reportWebhookUrl: z.string(),
  receiptWebhookUrl: z.string(),
});

/**
 * POST /api/settings/admin/gemini-models/available
 * apiKeyが空(省略)の場合は保存済みのキーを使う(GAS版listAvailableGeminiModelsForAdminと同じ)。
 */
export const listGeminiModelsRequestSchema = z.object({ apiKey: z.string().optional() });
export const geminiModelInfoSchema = z.object({ name: z.string(), displayName: z.string() });
export const listGeminiModelsResponseSchema = z.object({
  success: z.literal(true),
  models: z.array(geminiModelInfoSchema),
});

/** 編集可能なAIプロンプト/プレースホルダー1件(GET /api/settings/admin/prompts)。 */
export const aiPromptViewSchema = z.object({
  key: z.string(),
  kind: z.enum(['prompt', 'placeholder']),
  label: z.string(),
  /** 現在有効な本文(テナントの上書きが無ければ既定値)。 */
  body: z.string(),
  defaultBody: z.string(),
  /** テナントが既定値を上書きしているか。 */
  customized: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type AiPromptView = z.infer<typeof aiPromptViewSchema>;
export const aiPromptListResponseSchema = z.object({ prompts: z.array(aiPromptViewSchema) });

/**
 * PUT /api/settings/admin/prompts
 * bodyにnull(または空文字)を渡すとテナントの上書きを削除し既定値に戻す。
 */
export const updateAiPromptsRequestSchema = z.object({
  prompts: z
    .array(z.object({ key: z.string(), body: z.string().nullable() }))
    .min(1, '更新するプロンプトがありません'),
});
export type UpdateAiPromptsRequest = z.infer<typeof updateAiPromptsRequestSchema>;
