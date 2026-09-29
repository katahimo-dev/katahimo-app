import type { SaveSettingsResult } from '@katahimo/core/usecases';
import {
  getAdminSettings,
  listAiPromptsForAdmin,
  saveGeminiApiKey,
  saveGoogleChatWebhookSettings,
  updateAiPrompts,
} from '@katahimo/core/usecases';
import {
  adminSettingsResponseSchema,
  aiPromptListResponseSchema,
  saveGchatWebhooksRequestSchema,
  saveGeminiApiKeyRequestSchema,
  saveSettingsResponseSchema,
  updateAiPromptsRequestSchema,
} from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
import { apiError, jsonOk, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireAdmin } from '../session';

function respondSave(c: Context, result: SaveSettingsResult) {
  if (!result.ok) return apiError(c, 400, 'validation_failed', result.message);
  return jsonOk(c, saveSettingsResponseSchema, result);
}

/**
 * 管理者設定(GAS版の設定モーダル「管理者設定」)。全て管理者専用で、管理者以外・未ログインの
 * アクセスはrequireAdminがWARNログに残す(GAS版logAdminAccessDenied_)。
 */
export function createSettingsRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 現在の管理者設定を返す(APIキー・Webhook URLは伏せ字と設定済みフラグだけ)。 */
  app.get('/admin', requireAdmin(container, 'settings.admin.view'), async (c) => {
    return jsonOk(c, adminSettingsResponseSchema, {
      settings: await getAdminSettings(container, actorOf(c)),
    });
  });

  app.post('/admin/gemini-key', requireAdmin(container, 'settings.gemini_api_key.save'), async (c) => {
    const body = await parseJsonBody(c, saveGeminiApiKeyRequestSchema);
    if (!body.ok) return body.response;
    return respondSave(c, await saveGeminiApiKey(container, actorOf(c), body.data.apiKey));
  });

  app.post('/admin/gchat-webhooks', requireAdmin(container, 'settings.gchat_webhooks.save'), async (c) => {
    const body = await parseJsonBody(c, saveGchatWebhooksRequestSchema);
    if (!body.ok) return body.response;
    return respondSave(
      c,
      await saveGoogleChatWebhookSettings(
        container,
        actorOf(c),
        body.data.reportWebhookUrl,
        body.data.receiptWebhookUrl,
      ),
    );
  });

  /** 編集可能なAIプロンプト・入力欄プレースホルダーの一覧(GAS版「ＡＩプロンプト」シート)。 */
  app.get('/admin/prompts', requireAdmin(container, 'settings.ai_prompts.view'), async (c) => {
    return jsonOk(c, aiPromptListResponseSchema, {
      prompts: await listAiPromptsForAdmin(container, c.get('session').tenantId),
    });
  });

  app.put('/admin/prompts', requireAdmin(container, 'settings.ai_prompts.save'), async (c) => {
    const body = await parseJsonBody(c, updateAiPromptsRequestSchema);
    if (!body.ok) return body.response;
    const { tenantId, staffId, meta } = actorOf(c);
    const result = await updateAiPrompts(container, {
      tenantId,
      staffId,
      prompts: body.data.prompts,
      ...(meta ? { meta } : {}),
    });
    if (!result.ok) {
      return apiError(c, 400, 'validation_failed', `不明なプロンプトです: ${result.keys.join(', ')}`);
    }
    return jsonOk(c, aiPromptListResponseSchema, { prompts: result.prompts });
  });

  return app;
}
