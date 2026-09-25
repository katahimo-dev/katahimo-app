import { getScheduleForStaff, getScheduleWithRouteForStaff } from '@katahimo/core';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveScheduleTargetStaffId } from '../session';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createScheduleRoutes(container: Container) {
  const app = new Hono();

  /** 指定日の予定一覧(ルート・移動時間は含まない軽量版)。GAS版Schedule.js getScheduleForDate相当。 */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const date = c.req.query('date');
    if (!date || !DATE_PATTERN.test(date)) {
      return c.json(
        { code: 'validation_failed', message: 'date(YYYY-MM-DD)クエリパラメータが必要です' },
        400,
      );
    }

    const staffId = resolveScheduleTargetStaffId(session, c.req.query('staffId'));
    const result = await getScheduleForStaff(container, session.tenantId, staffId, date);
    return c.json(result);
  });

  /**
   * 指定日の予定にルート・移動時間を付与して取得する。Google Maps連携(ブリッジ経由)を伴うため
   * 軽量版より時間がかかる。GAS版Schedule.js getRouteForStaffOnDate相当。
   */
  app.get('/route', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const date = c.req.query('date');
    if (!date || !DATE_PATTERN.test(date)) {
      return c.json(
        { code: 'validation_failed', message: 'date(YYYY-MM-DD)クエリパラメータが必要です' },
        400,
      );
    }

    const staffId = resolveScheduleTargetStaffId(session, c.req.query('staffId'));
    const forceRefresh = c.req.query('forceRefresh') === '1';
    const result = await getScheduleWithRouteForStaff(
      container,
      session.tenantId,
      staffId,
      date,
      forceRefresh,
    );
    return c.json(result);
  });

  return app;
}
