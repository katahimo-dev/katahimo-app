import {
  type AuthenticatedIntegrationKey,
  authenticateIntegrationApiKey,
  consumeQuota,
} from '@katahimo/core/usecases';
import { ingestIntegrationCustomers } from '@katahimo/ingestion';
import { integrationCustomersRequestSchema, integrationCustomersResponseSchema } from '@katahimo/shared';
import { Hono, type MiddlewareHandler } from 'hono';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError, jsonOk, parseJsonBody, rateLimited } from '../http/responses';

/** ルートの Context 変数(requireIntegrationKey が設定する)。 */
export interface IntegrationEnv {
  Variables: { integrationKey: AuthenticatedIntegrationKey };
}

/** `Authorization: Bearer <token>` のトークン(無ければ null)。 */
function bearerTokenOf(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

/**
 * 外部システム連携の API キーの確認。Cookie のセッションは見ない(ログイン中の画面からは呼べない)。
 * キーが無い・誤り・失効は 401、テナントが利用停止中は 403(どちらも WARN `integration.auth_failed`)。
 */
function requireIntegrationKey(container: Container): MiddlewareHandler<IntegrationEnv> {
  return async (c, next) => {
    const result = await authenticateIntegrationApiKey(
      container,
      bearerTokenOf(c.req.header('authorization')),
      requestMeta(c),
    );
    if (!result.ok) {
      if (result.reason === 'tenant_suspended') {
        return apiError(c, 403, 'forbidden', 'この法人は利用を停止しています。');
      }
      c.header('WWW-Authenticate', 'Bearer');
      return apiError(c, 401, 'unauthenticated', 'API キーが無効です。');
    }
    c.set('integrationKey', result.key);
    return next();
  };
}

/**
 * 外部システム連携(/api/integrations)。RESERVA 等からの顧客の受け取りの受け口(doc/04 2.11・doc/05 11章)。
 * テナントと書ける取込元は API キーで決まる(本文にテナント・取込元の指定は無い)。
 */
export function createIntegrationRoutes(container: Container) {
  const app = new Hono<IntegrationEnv>();

  /** 顧客を作成・更新する(1回500件まで。削除・アーカイブはしない)。API キー単位の1時間の回数の上限あり。 */
  app.post('/customers', requireIntegrationKey(container), async (c) => {
    const key = c.get('integrationKey');
    const decision = await consumeQuota(
      container,
      container.rateLimits.integrationCustomersKey,
      `${key.tenantId}:${key.apiKeyId}`,
      { tenantId: key.tenantId, meta: requestMeta(c) },
    );
    if (!decision.allowed) {
      return rateLimited(
        c,
        decision.retryAfterMs,
        '送信の回数が上限に達しました。しばらく待ってから再度お試しください。',
      );
    }
    const body = await parseJsonBody(c, integrationCustomersRequestSchema);
    if (!body.ok) return body.response;
    const result = await ingestIntegrationCustomers(container, key, body.data.customers, requestMeta(c));
    return jsonOk(c, integrationCustomersResponseSchema, result);
  });

  return app;
}
