import type { SaveSettingsResult } from '@katahimo/core';
import {
  getAdminSettings,
  listAiPromptsForAdmin,
  listGeminiModelsForAdmin,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
  updateAiPrompts,
} from '@katahimo/core';
import {
  listGeminiModelsRequestSchema,
  saveGchatWebhooksRequestSchema,
  saveGeminiApiKeyRequestSchema,
  saveGeminiModelsRequestSchema,
  updateAiPromptsRequestSchema,
} from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError, parseJsonBody } from '../http/responses';
import type { SessionEnv } from '../session';
import { requireAdmin } from '../session';

function actorOf(c: Context<SessionEnv>) {
  const session = c.get('session');
  return { tenantId: session.tenantId, staffId: session.staffId, meta: requestMeta(c) };
}

function respondSave(c: Context, result: SaveSettingsResult) {
  if (!result.ok) return apiError(c, 400, 'validation_failed', result.message);
  return c.json(result);
}

/**
 * 管理者設定(GAS版の設定モーダル「管理者設定」)。全て管理者専用で、管理者以外・未ログインの
 * アクセスはrequireAdminがWARNログに残す(GAS版logAdminAccessDenied_)。
 */
export function createSettingsRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 現在の管理者設定を復号して返す(閲覧はSECURITYログに残る)。 */
  app.get('/admin', requireAdmin(container, 'settings.admin.view'), async (c) => {
    return c.json({ settings: await getAdminSettings(container, actorOf(c)) });
  });

  app.post('/admin/gemini-key', requireAdmin(container, 'settings.gemini_api_key.save'), async (c) => {
    const body = await parseJsonBody(c, saveGeminiApiKeyRequestSchema);
    if (!body.ok) return body.response;
    return respondSave(c, await saveGeminiApiKey(container, actorOf(c), body.data.apiKey));
  });

  app.post('/admin/gemini-models', requireAdmin(container, 'settings.gemini_models.save'), async (c) => {
    const body = await parseJsonBody(c, saveGeminiModelsRequestSchema);
    if (!body.ok) return body.response;
    return respondSave(
      c,
      await saveGeminiModelSettings(container, actorOf(c), body.data.reportModel, body.data.ocrModel),
    );
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

  /** 入力中のキー(空なら保存済みのキー)で使えるモデル一覧を取得する。 */
  app.post(
    '/admin/gemini-models/available',
    requireAdmin(container, 'settings.gemini_models.list'),
    async (c) => {
      const body = await parseJsonBody(c, listGeminiModelsRequestSchema);
      if (!body.ok) return body.response;
      const result = await listGeminiModelsForAdmin(container, actorOf(c), body.data.apiKey);
      if (!result.ok) {
        return apiError(c, result.reason === 'no_api_key' ? 400 : 502, 'validation_failed', result.message);
      }
      return c.json({ success: true as const, models: result.models });
    },
  );

  /** 編集可能なAIプロンプト・入力欄プレースホルダーの一覧(GAS版「ＡＩプロンプト」シート)。 */
  app.get('/admin/prompts', requireAdmin(container, 'settings.ai_prompts.view'), async (c) => {
    return c.json({ prompts: await listAiPromptsForAdmin(container, c.get('session').tenantId) });
  });

  app.put('/admin/prompts', requireAdmin(container, 'settings.ai_prompts.save'), async (c) => {
    const body = await parseJsonBody(c, updateAiPromptsRequestSchema);
    if (!body.ok) return body.response;
    const actor = actorOf(c);
    const result = await updateAiPrompts(container, { ...actor, prompts: body.data.prompts });
    if (!result.ok) {
      return apiError(c, 400, 'validation_failed', `不明なプロンプトです: ${result.keys.join(', ')}`);
    }
    return c.json({ prompts: result.prompts });
  });

  return app;
}
