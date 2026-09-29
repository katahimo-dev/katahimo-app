import { z } from 'zod';
import { freeText } from './common';

/** 秘密値を伏せ字にするときの文字。保存APIはこの文字を含む値を「変更なし」として扱う。 */
export const SECRET_MASK_CHAR = '•';

/**
 * GET /api/settings/admin (管理者のみ)
 *
 * APIキー・Webhook URLは平文では返さず、伏せ字にした値(SECRET_MASK_CHAR を含む。未設定なら空文字)と
 * 設定済みかどうかだけを返す。APIキーは末尾4文字、Webhook URLはスペースのパスまで(key/token の
 * クエリは伏せる)を残す。保存API(gemini-key / gchat-webhooks)に伏せ字の
 * ままの値を送ると、保存済みの値をそのまま使う(変更なし)。
 */
export const adminSettingsViewSchema = z.object({
  geminiApiKey: z.string(),
  geminiApiKeySet: z.boolean(),
  gchatReportWebhookUrl: z.string(),
  gchatReportWebhookUrlSet: z.boolean(),
  gchatReceiptWebhookUrl: z.string(),
  gchatReceiptWebhookUrlSet: z.boolean(),
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

/** POST /api/settings/admin/gemini-key(伏せ字のままの値は「変更なし」) */
export const saveGeminiApiKeyRequestSchema = z.object({ apiKey: z.string().max(500) });
/**
 * POST /api/settings/admin/gchat-webhooks
 * 省略した項目・伏せ字のままの項目は保存済みの値を使う。新しい値は Google Chat の Incoming Webhook
 * (`https://chat.googleapis.com/v1/spaces/...`)だけを受け付ける(それ以外のURLへの送信を防ぐため)。
 */
export const saveGchatWebhooksRequestSchema = z.object({
  reportWebhookUrl: z.string().max(2000).optional(),
  receiptWebhookUrl: z.string().max(2000).optional(),
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
  /** 最新の版(保存したことが無ければ 0)。PUT で渡すと、他の管理者の保存との競合を 409 にする。 */
  revision: z.number().int().nonnegative(),
});
export type AiPromptView = z.infer<typeof aiPromptViewSchema>;
export const aiPromptListResponseSchema = z.object({ prompts: z.array(aiPromptViewSchema) });

/**
 * PUT /api/settings/admin/prompts
 * bodyにnull(または空文字)を渡すとテナントの上書きを削除し既定値に戻す。revision(GET で読んだ版)を渡すと、
 * その後に他の管理者が保存していれば何も変えずに 409 conflict にする。
 */
export const updateAiPromptsRequestSchema = z.object({
  prompts: z
    .array(
      z.object({
        key: z.string(),
        body: freeText(z.string().max(20000, 'プロンプトが長すぎます').nullable()),
        revision: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1, '更新するプロンプトがありません'),
});
export type UpdateAiPromptsRequest = z.infer<typeof updateAiPromptsRequestSchema>;
