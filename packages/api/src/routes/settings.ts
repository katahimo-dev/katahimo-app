import {
  getAdminSettings,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
} from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

/**
 * GAS版の各getXXXForAdmin/saveXXXForAdminの `!session.isAdmin` チェックに対応。
 * 管理者以外には403を返す(GAS版は`{success:false, message:'権限がありません。'}`を200で
 * 返していたが、RESTらしく403にする)。
 */
function isAdmin(session: ResolvedSession | null): session is ResolvedSession {
  return !!session && session.isAdmin;
}

export function createSettingsRoutes(container: Container) {
  const app = new Hono();

  /** 現在の管理者設定を復号して返す。GAS版のgetGeminiApiKeyForAdmin等をまとめたもの。 */
  app.get('/admin', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const settings = await getAdminSettings(container, session.tenantId);
    return c.json({ settings });
  });

  /** GAS版saveGeminiApiKeyForAdmin相当。空文字は拒否される(usecase側のガード)。 */
  app.post('/admin/gemini-key', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.apiKey !== 'string') {
      return c.json({ ok: false, message: 'apiKey が必要です' }, 400);
    }
    const result = await saveGeminiApiKey(container, session.tenantId, body.apiKey);
    return c.json(result);
  });

  /** GAS版saveGeminiModelSettingsForAdmin相当。 */
  app.post('/admin/gemini-models', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.reportModel !== 'string' || typeof body?.ocrModel !== 'string') {
      return c.json({ ok: false, message: 'reportModel, ocrModel が必要です' }, 400);
    }
    const result = await saveGeminiModelSettings(
      container,
      session.tenantId,
      body.reportModel,
      body.ocrModel,
    );
    return c.json(result);
  });

  /** GAS版saveGoogleChatWebhookSettingsForAdmin相当。 */
  app.post('/admin/gchat-webhooks', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.reportWebhookUrl !== 'string' || typeof body?.receiptWebhookUrl !== 'string') {
      return c.json({ ok: false, message: 'reportWebhookUrl, receiptWebhookUrl が必要です' }, 400);
    }
    const result = await saveGoogleChatWebhookSettings(
      container,
      session.tenantId,
      body.reportWebhookUrl,
      body.receiptWebhookUrl,
    );
    return c.json(result);
  });

  /**
   * 保存前の入力中キーでも確認できるよう、apiKeyは明示的にリクエストボディで受け取る
   * (GAS版listAvailableGeminiModelsForAdminのapiKeyOverrideと同じ)。
   */
  app.post('/admin/gemini-models/available', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) {
      return c.json({
        success: false,
        message: 'Gemini APIキーが設定されていません。先にAPIキーを入力してください。',
      });
    }
    try {
      const models = await container.listGeminiModels(apiKey);
      return c.json({ success: true, models });
    } catch (e) {
      return c.json({ success: false, message: e instanceof Error ? e.message : String(e) });
    }
  });

  return app;
}
