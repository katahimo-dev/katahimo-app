import {
  type AttendanceActor,
  AttendanceError,
  applyCalendarSync,
  getAttendanceDay,
  getAttendanceMonth,
  getAttendanceScheduleEvents,
  previewCalendarSync,
  refreshAttendanceAggregate,
  updateAttendanceDay,
} from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
import {
  attendanceDayQuerySchema,
  attendanceMonthQuerySchema,
  attendanceWeekQuerySchema,
  calendarSyncApplyRequestSchema,
  calendarSyncQuerySchema,
  refreshAttendanceAggregateRequestSchema,
  updateAttendanceDayRequestSchema,
} from '@katahimo/shared';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveAttendanceTargetStaffId } from '../session';
import { parseJsonBody, parseQuery } from '../validation';

const ERROR_RESPONSES: Record<AttendanceError['code'], { status: ContentfulStatusCode; code: string }> = {
  staff_not_found: { status: 404, code: 'not_found' },
  forbidden: { status: 403, code: 'forbidden' },
  locked: { status: 400, code: 'locked' },
  invalid_request: { status: 400, code: 'validation_failed' },
  schedule_unavailable: { status: 502, code: 'upstream_unavailable' },
};

function toActor(session: ResolvedSession): AttendanceActor {
  return { tenantId: session.tenantId, staffId: session.staffId, isAdmin: session.isAdmin };
}

/**
 * 出勤簿(過去の予定タブ)のAPI。GAS版 PastSchedule.js の各関数に対応する
 * (doc/api/attendance-batch.md)。対象スタッフは一般スタッフなら常に本人、管理者だけが
 * staffId で他スタッフを指定できる(resolveAttendanceTargetStaffId)。
 */
export function createAttendanceRoutes(container: Container) {
  const app = new Hono<{ Variables: { session: ResolvedSession } }>();

  app.use('*', async (c, next) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    c.set('session', session);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof AttendanceError) {
      const { status, code } = ERROR_RESPONSES[error.code];
      return c.json({ code, message: error.message }, status);
    }
    throw error;
  });

  const target = (c: Context<{ Variables: { session: ResolvedSession } }>, staffId: string | undefined) =>
    resolveAttendanceTargetStaffId(c.get('session'), staffId);

  /** 指定日の出勤簿1日分(GAS版 getPastScheduleForDate)。 */
  app.get('/day', async (c) => {
    const query = parseQuery(c, attendanceDayQuerySchema);
    if (!query.ok) return query.response;
    const attendance = await getAttendanceDay(
      container,
      toActor(c.get('session')),
      target(c, query.data.staffId),
      query.data.date,
    );
    return c.json({ attendance });
  });

  /** 手入力の修正(GAS版 updatePastSchedule)。当月以外は 400 locked。送られた列のうち変わった列だけを書く。 */
  app.put('/day', async (c) => {
    const body = await parseJsonBody(c, updateAttendanceDayRequestSchema);
    if (!body.ok) return body.response;
    const result = await updateAttendanceDay(
      container,
      toActor(c.get('session')),
      target(c, body.data.staffId),
      body.data.date,
      body.data.rowData,
    );
    return c.json({
      attendance: result.attendance,
      changedCount: result.changes.length,
      changedColumns: result.changes.map((change) => change.column),
      message: result.message,
    });
  });

  /** カレンダーから反映した場合の差分(書き込みなし)。GAS版 previewCalendarSyncForStaffOnDate。 */
  app.get('/day/calendar-sync/preview', async (c) => {
    const query = parseQuery(c, calendarSyncQuerySchema);
    if (!query.ok) return query.response;
    const preview = await previewCalendarSync(
      container,
      toActor(c.get('session')),
      target(c, query.data.staffId),
      query.data.date,
    );
    return c.json(preview);
  });

  /**
   * カレンダーの予定を出勤簿へ反映する(GAS版 applyCalendarSyncForStaffOnDate / syncPastScheduleFromCalendar)。
   * 冪等。管理者の期間一括反映はクライアントがスタッフ×日ごとに順に呼ぶ。
   */
  app.post('/day/calendar-sync', async (c) => {
    const body = await parseJsonBody(c, calendarSyncApplyRequestSchema);
    if (!body.ok) return body.response;
    const result = await applyCalendarSync(
      container,
      toActor(c.get('session')),
      target(c, body.data.staffId),
      body.data.date,
    );
    return c.json({ ...result, changedCount: result.changes.length });
  });

  /** 管理者専用: 「勤怠集計」シートの該当行の書き直し(GAS版 refreshAttendanceForStaffOnDate)。 */
  app.post('/day/aggregate/refresh', async (c) => {
    const body = await parseJsonBody(c, refreshAttendanceAggregateRequestSchema);
    if (!body.ok) return body.response;
    const result = await refreshAttendanceAggregate(
      container,
      toActor(c.get('session')),
      body.data.staffId,
      body.data.date,
    );
    return c.json(result);
  });

  /** 月次まとめ(GAS版 getAttendanceMonth)。月の全日・合計・領収書集計。 */
  app.get('/month', async (c) => {
    const query = parseQuery(c, attendanceMonthQuerySchema);
    if (!query.ok) return query.response;
    const month = await getAttendanceMonth(
      container,
      toActor(c.get('session')),
      target(c, query.data.staffId),
      query.data.month,
    );
    return c.json({ month });
  });

  /** 週間予定(出勤簿の記録をイベント化した閲覧専用ビュー、最大31日)。GAS版 getWeeklyScheduleForStaff。 */
  app.get('/week', async (c) => {
    const query = parseQuery(c, attendanceWeekQuerySchema);
    if (!query.ok) return query.response;
    const events = await getAttendanceScheduleEvents(
      container,
      toActor(c.get('session')),
      target(c, query.data.staffId),
      query.data.start,
      query.data.end,
    );
    return c.json({ events });
  });

  return app;
}
