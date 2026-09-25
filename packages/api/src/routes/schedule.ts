import { getScheduleForStaff, getScheduleWithRouteForStaff } from '@katahimo/core';
import { businessDateSchema } from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveScheduleTargetStaffId } from '../session';

/**
 * 「予定」タブのAPI。GAS版Schedule.js(getScheduleForDate / getRouteForStaffOnDate)相当。
 * 管理者以外は常に本人の予定、管理者は staffId クエリで他スタッフの予定も見られる。
 * ログ(ルート計算のINFO・失敗のWARN/ERROR)は usecases/schedule.ts が記録する。
 */
export function createScheduleRoutes(container: Container) {
  const app = new Hono();

  /** 指定日の予定一覧(ルート・移動時間は含まない軽量版)。 */
  app.get('/', async (c) => {
    const request = await parseScheduleRequest(c, container);
    if ('error' in request) return request.error;
    return c.json(await getScheduleForStaff(container, request));
  });

  /** 指定日の予定にルート・移動時間を付与して取得する(地図APIの有料呼び出しを伴う)。 */
  app.get('/route', async (c) => {
    const request = await parseScheduleRequest(c, container);
    if ('error' in request) return request.error;
    const forceRefresh = c.req.query('forceRefresh') === '1';
    return c.json(await getScheduleWithRouteForStaff(container, { ...request, forceRefresh }));
  });

  return app;
}

async function parseScheduleRequest(c: Context, container: Container) {
  const session = await getAuthenticatedSession(c, container);
  if (!session) return { error: c.json({ code: 'unauthenticated', message: '未ログインです' }, 401) };

  const date = businessDateSchema.safeParse(c.req.query('date'));
  if (!date.success) {
    return {
      error: c.json(
        { code: 'validation_failed', message: 'date(YYYY-MM-DD)クエリパラメータが必要です' },
        400,
      ),
    };
  }

  return {
    tenantId: session.tenantId,
    actorStaffId: session.staffId,
    targetStaffId: resolveScheduleTargetStaffId(session, c.req.query('staffId')),
    date: date.data,
  };
}
