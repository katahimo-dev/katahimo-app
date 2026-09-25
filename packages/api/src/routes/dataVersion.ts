import { Hono } from 'hono';
import type { Container } from '../container';
import { requireSession, type SessionEnv } from '../session';

/**
 * GET /api/data-version: 顧客データの版数(GAS版 checkDataVersion)。クライアントは60秒ごとに
 * ポーリングし、前回と違えば顧客一覧を読み直す。顧客CSVを取り込むたびに増える。
 */
export function createDataVersionRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.get('/', requireSession(container), async (c) => {
    const state = await container.importState.get(c.get('session').tenantId);
    return c.json({ dataVersion: String(state.dataVersion) });
  });

  return app;
}
