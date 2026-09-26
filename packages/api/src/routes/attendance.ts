import {
  applyCalendarSync,
  getAttendanceDay,
  getAttendanceMonth,
  getAttendanceScheduleEvents,
  previewCalendarSync,
  refreshAttendanceAggregate,
  updateAttendanceDay,
} from '@katahimo/core/usecases';
import {
  attendanceDayQuerySchema,
  attendanceDayResponseSchema,
  attendanceMonthQuerySchema,
  attendanceMonthResponseSchema,
  attendanceWeekQuerySchema,
  attendanceWeekResponseSchema,
  calendarSyncApplyRequestSchema,
  calendarSyncApplyResponseSchema,
  calendarSyncPreviewResponseSchema,
  calendarSyncQuerySchema,
  refreshAttendanceAggregateRequestSchema,
  refreshAttendanceAggregateResponseSchema,
  updateAttendanceDayRequestSchema,
  updateAttendanceDayResponseSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { jsonOk, parseJsonBody, parseQuery } from '../http/responses';
import { actorOf, requireSession, type SessionEnv, targetStaffIdOf } from '../session';

/**
 * 出勤簿(過去の予定タブ)の API。GAS版 PastSchedule.js の各関数に対応する(doc/04_API仕様.md 2.5)。
 * 対象スタッフは一般スタッフなら常に本人、管理者・コーディネーターだけが staffId で他のスタッフを指定できる。
 * usecase の DomainError(locked・conflict 等)は app.onError が応答にする。
 */
export function createAttendanceRoutes(container: Container) {
  const app = new Hono<SessionEnv>();
  app.use('*', requireSession(container, 'attendance'));

  /** 指定日の出勤簿1日分(GAS版 getPastScheduleForDate)。 */
  app.get('/day', async (c) => {
    const query = parseQuery(c, attendanceDayQuerySchema);
    if (!query.ok) return query.response;
    const attendance = await getAttendanceDay(
      container,
      actorOf(c),
      targetStaffIdOf(c, query.data.staffId),
      query.data.date,
    );
    return jsonOk(c, attendanceDayResponseSchema, { attendance });
  });

  /**
   * 手入力の修正(GAS版 updatePastSchedule)。当月以外は 400 locked。送られた列のうち変わった列だけを書く。
   * rowVersion を送れば、画面を開いた後に他の人が保存していた場合に 409 conflict。
   */
  app.put('/day', async (c) => {
    const body = await parseJsonBody(c, updateAttendanceDayRequestSchema);
    if (!body.ok) return body.response;
    const result = await updateAttendanceDay(
      container,
      actorOf(c),
      targetStaffIdOf(c, body.data.staffId),
      body.data.date,
      body.data.rowData,
      body.data.rowVersion,
    );
    return jsonOk(c, updateAttendanceDayResponseSchema, {
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
      actorOf(c),
      targetStaffIdOf(c, query.data.staffId),
      query.data.date,
    );
    return jsonOk(c, calendarSyncPreviewResponseSchema, preview);
  });

  /**
   * カレンダーの予定を出勤簿へ反映する(GAS版 applyCalendarSyncForStaffOnDate / syncPastScheduleFromCalendar)。
   * 冪等。期間の一括反映はクライアントがスタッフ×日ごとに順に呼ぶ。
   */
  app.post('/day/calendar-sync', async (c) => {
    const body = await parseJsonBody(c, calendarSyncApplyRequestSchema);
    if (!body.ok) return body.response;
    const result = await applyCalendarSync(
      container,
      actorOf(c),
      targetStaffIdOf(c, body.data.staffId),
      body.data.date,
    );
    return jsonOk(c, calendarSyncApplyResponseSchema, { ...result, changedCount: result.changes.length });
  });

  /** 管理者専用: 「勤怠集計」シートの該当行の書き直し(GAS版 refreshAttendanceForStaffOnDate)。 */
  app.post('/day/aggregate/refresh', async (c) => {
    const body = await parseJsonBody(c, refreshAttendanceAggregateRequestSchema);
    if (!body.ok) return body.response;
    const result = await refreshAttendanceAggregate(container, actorOf(c), body.data.staffId, body.data.date);
    return jsonOk(c, refreshAttendanceAggregateResponseSchema, result);
  });

  /** 月次まとめ(GAS版 getAttendanceMonth)。月の全日・合計・領収書集計。 */
  app.get('/month', async (c) => {
    const query = parseQuery(c, attendanceMonthQuerySchema);
    if (!query.ok) return query.response;
    const month = await getAttendanceMonth(
      container,
      actorOf(c),
      targetStaffIdOf(c, query.data.staffId),
      query.data.month,
    );
    return jsonOk(c, attendanceMonthResponseSchema, { month });
  });

  /** 週間予定(出勤簿の記録をイベント化した閲覧専用ビュー、最大31日)。GAS版 getWeeklyScheduleForStaff。 */
  app.get('/week', async (c) => {
    const query = parseQuery(c, attendanceWeekQuerySchema);
    if (!query.ok) return query.response;
    const events = await getAttendanceScheduleEvents(
      container,
      actorOf(c),
      targetStaffIdOf(c, query.data.staffId),
      query.data.start,
      query.data.end,
    );
    return jsonOk(c, attendanceWeekResponseSchema, { events });
  });

  return app;
}
