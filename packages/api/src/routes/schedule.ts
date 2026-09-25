import { getScheduleForStaff, getScheduleWithRouteForStaff } from '@katahimo/core';
import { businessDateSchema } from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
import { enforceStaffQuota } from '../http/quota';
import { requestMeta } from '../http/requestMeta';
import { apiError } from '../http/responses';
import type { SessionEnv } from '../session';
import { requireSession, resolveScheduleTargetStaffId } from '../session';

/**
 * 「予定」タブのAPI。GAS版Schedule.js(getScheduleForDate / getRouteForStaffOnDate)相当。
 * 管理者以外は常に本人の予定、管理者は staffId クエリで他スタッフの予定も見られる。
 * ログ(ルート計算のINFO・失敗のWARN/ERROR)は usecases/schedule.ts が記録する。
 */
export function createScheduleRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** 指定日の予定一覧(ルート・移動時間は含まない軽量版)。 */
  app.get('/', requireSession(container, 'schedule.view'), async (c) => {
    const request = parseScheduleRequest(c);
    if (!request.ok) return request.response;
    return c.json(await getScheduleForStaff(container, request.data));
  });

  /** 指定日の予定にルート・移動時間を付与して取得する(地図APIの有料呼び出しを伴う)。 */
  app.get('/route', requireSession(container, 'schedule.route'), async (c) => {
    const request = parseScheduleRequest(c);
    if (!request.ok) return request.response;
    const forceRefresh = c.req.query('forceRefresh') === '1';
    if (forceRefresh) {
      const limited = await enforceStaffQuota(
        c,
        container,
        container.rateLimits.scheduleForceRefreshStaff,
        'ルートの再計算の回数が上限に達しました。しばらく待ってから再度お試しください。',
      );
      if (limited) return limited;
    }
    return c.json(await getScheduleWithRouteForStaff(container, { ...request.data, forceRefresh }));
  });

  return app;
}

function parseScheduleRequest(c: Context<SessionEnv>) {
  const date = businessDateSchema.safeParse(c.req.query('date'));
  if (!date.success) {
    return {
      ok: false as const,
      response: apiError(c, 400, 'validation_failed', 'date(YYYY-MM-DD)クエリパラメータが必要です', {
        date: date.error.issues[0]?.message ?? 'YYYY-MM-DD 形式で指定してください',
      }),
    };
  }
  const session = c.get('session');
  return {
    ok: true as const,
    data: {
      tenantId: session.tenantId,
      actorStaffId: session.staffId,
      targetStaffId: resolveScheduleTargetStaffId(session, c.req.query('staffId')),
      date: date.data,
      meta: requestMeta(c),
    },
  };
}
