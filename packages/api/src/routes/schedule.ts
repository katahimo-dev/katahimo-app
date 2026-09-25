import type { ScheduleViewRequest } from '@katahimo/core/usecases';
import { getScheduleForStaff, getScheduleWithRouteForStaff } from '@katahimo/core/usecases';
import {
  scheduleLightResponseSchema,
  scheduleQuerySchema,
  scheduleRouteQuerySchema,
  scheduleWithRouteResponseSchema,
} from '@katahimo/shared';
import type { Context } from 'hono';
import { Hono } from 'hono';
import type { Container } from '../container';
import { enforceStaffQuota } from '../http/quota';
import { requestMeta } from '../http/requestMeta';
import { jsonOk, parseQuery } from '../http/responses';
import type { SessionEnv } from '../session';
import { requireSession, targetStaffIdOf } from '../session';

/**
 * 「予定」タブの API(GAS版 Schedule.js getScheduleForDate / getRouteForStaffOnDate)。一般スタッフは常に本人の
 * 予定、管理者・コーディネーターは staffId で他のスタッフの予定も見られる。外部サービスの失敗は usecase が
 * 詳細をログに残し、一般的な文言の 502 にする。
 */
export function createScheduleRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  const requestOf = (
    c: Context<SessionEnv>,
    query: { date: string; staffId?: string | undefined },
  ): ScheduleViewRequest => {
    const session = c.get('session');
    return {
      tenantId: session.tenantId,
      actorStaffId: session.staffId,
      targetStaffId: targetStaffIdOf(c, query.staffId),
      date: query.date,
      meta: requestMeta(c),
    };
  };

  /** 指定日の予定一覧(ルート・移動時間は含まない軽量版)。 */
  app.get('/', requireSession(container, 'schedule.view'), async (c) => {
    const query = parseQuery(c, scheduleQuerySchema);
    if (!query.ok) return query.response;
    return jsonOk(
      c,
      scheduleLightResponseSchema,
      await getScheduleForStaff(container, requestOf(c, query.data)),
    );
  });

  /** 指定日の予定にルート・移動時間を付けて返す(地図 API の有料呼び出しを伴う)。 */
  app.get('/route', requireSession(container, 'schedule.route'), async (c) => {
    const query = parseQuery(c, scheduleRouteQuerySchema);
    if (!query.ok) return query.response;
    const forceRefresh = query.data.forceRefresh === '1';
    if (forceRefresh) {
      const limited = await enforceStaffQuota(
        c,
        container,
        container.rateLimits.scheduleForceRefreshStaff,
        'ルートの再計算の回数が上限に達しました。しばらく待ってから再度お試しください。',
      );
      if (limited) return limited;
    }
    const result = await getScheduleWithRouteForStaff(container, {
      ...requestOf(c, query.data),
      forceRefresh,
    });
    return jsonOk(c, scheduleWithRouteResponseSchema, result);
  });

  return app;
}
