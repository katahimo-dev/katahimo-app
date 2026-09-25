import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

/**
 * GET /api/data-version: 顧客データの版数(GAS版 checkDataVersion)。クライアントは60秒ごとに
 * ポーリングし、前回と違えば顧客一覧を読み直す。顧客CSVを取り込むたびに増える。
 */
export function createDataVersionRoutes(container: Container) {
  const app = new Hono();

  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    const state = await container.importState.get(session.tenantId);
    return c.json({ dataVersion: String(state.dataVersion) });
  });

  return app;
}
