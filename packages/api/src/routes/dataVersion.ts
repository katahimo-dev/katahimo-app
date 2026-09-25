import { dataVersionResponseSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { jsonOk } from '../http/responses';
import { requireSession, type SessionEnv } from '../session';

/**
 * GET /api/data-version: 顧客データの版数(tenant_settings.customer_data_version。GAS版 checkDataVersion)。
 * クライアントは60秒ごとにポーリングし、前回と違えば顧客一覧を読み直す。顧客CSVを取り込むたびに増える。
 */
export function createDataVersionRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.get('/', requireSession(container), async (c) => {
    const settings = await container.uow.run(c.get('session').tenantId, (r) => r.settings.get());
    return jsonOk(c, dataVersionResponseSchema, { dataVersion: String(settings.customerDataVersion) });
  });

  return app;
}
