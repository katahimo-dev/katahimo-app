import {
  applyCalendarSync,
  exportAllStaffAttendance,
  exportAttendance,
  getAttendanceDay,
  getAttendanceMonth,
  getAttendanceScheduleEvents,
  previewCalendarSync,
  refreshAttendanceAggregate,
  updateAttendanceDay,
} from '@katahimo/core/usecases';
import {
  attendanceBulkExportQuerySchema,
  attendanceDayQuerySchema,
  attendanceDayResponseSchema,
  attendanceExportQuerySchema,
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
  XLSX_CONTENT_TYPE,
} from '@katahimo/shared';
import { type Context, Hono } from 'hono';
import type { Container } from '../container';
import {
  allStaffWorkbookSheets,
  buildAttendanceWorkbook,
  staffWorkbookSheets,
  yearMonthLabel,
} from '../export/attendanceWorkbook';
import { attachmentDisposition, safeFileName } from '../http/download';
import { enforceStaffQuota } from '../http/quota';
import { jsonOk, parseJsonBody, parseQuery, rateLimited } from '../http/responses';
import { actorOf, requireAdmin, requireSession, type SessionEnv, targetStaffIdOf } from '../session';

const EXPORT_RATE_LIMITED_MESSAGE =
  '出勤簿の書き出しの回数が上限に達しました。しばらく待ってから再度お試しください。';

/**
 * 全員分の書き出しを同時に作る数(このインスタンスの中)。全員分は1人1シートを1度にメモリの上で作るため、
 * 同時に重ならないようにする(API のメモリは 512Mi)。超えたら 429 で少し待ってもらう。
 */
const MAX_CONCURRENT_BULK_EXPORTS = 1;
let bulkExportsInFlight = 0;

/** .xlsx の応答(保存用。キャッシュさせない)。 */
function xlsxResponse(
  c: Context<SessionEnv>,
  body: Buffer,
  filename: string,
  asciiFallback: string,
): Response {
  c.header('Content-Type', XLSX_CONTENT_TYPE);
  c.header('Content-Disposition', attachmentDisposition(safeFileName(filename), asciiFallback));
  c.header('Content-Length', String(body.byteLength));
  c.header('Cache-Control', 'no-store');
  return c.body(new Uint8Array(body));
}

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

  /**
   * 出勤簿の Excel(.xlsx)の書き出し。month なら1か月(1シート)、fiscalYear なら年度の12か月(4月〜3月の12シート。
   * GAS版の個別出勤簿 `<スタッフ名>_出勤簿_<年度>年度` と同じ単位)。対象スタッフの決め方は /month と同じ。
   */
  app.get('/export', async (c) => {
    const query = parseQuery(c, attendanceExportQuerySchema);
    if (!query.ok) return query.response;
    const limited = await enforceStaffQuota(
      c,
      container,
      container.rateLimits.attendanceExportStaff,
      EXPORT_RATE_LIMITED_MESSAGE,
    );
    if (limited) return limited;
    const { month, fiscalYear, staffId } = query.data;
    const period =
      month !== undefined
        ? { kind: 'month' as const, yearMonth: month }
        : { kind: 'fiscal_year' as const, fiscalYear: fiscalYear as number };
    const exported = await exportAttendance(container, actorOf(c), targetStaffIdOf(c, staffId), period);
    const body = await buildAttendanceWorkbook(staffWorkbookSheets(exported));
    return period.kind === 'month'
      ? xlsxResponse(
          c,
          body,
          `出勤簿_${yearMonthLabel(period.yearMonth)}_${exported.staffName}.xlsx`,
          `attendance_${period.yearMonth}.xlsx`,
        )
      : xlsxResponse(
          c,
          body,
          `${exported.staffName}_出勤簿_${period.fiscalYear}年度.xlsx`,
          `attendance_fy${period.fiscalYear}.xlsx`,
        );
  });

  /** 管理者だけ: その月に在籍している全員の出勤簿を1つの .xlsx に(1人1シート、シート名はスタッフの名前)。 */
  app.get('/export/all', requireAdmin(container, 'attendance.export_all'), async (c) => {
    const query = parseQuery(c, attendanceBulkExportQuerySchema);
    if (!query.ok) return query.response;
    const limited = await enforceStaffQuota(
      c,
      container,
      container.rateLimits.attendanceExportStaff,
      EXPORT_RATE_LIMITED_MESSAGE,
    );
    if (limited) return limited;
    if (bulkExportsInFlight >= MAX_CONCURRENT_BULK_EXPORTS) {
      return rateLimited(
        c,
        30_000,
        'ほかの全員分の書き出しを作っています。少し待ってからもう一度お試しください。',
      );
    }
    bulkExportsInFlight++;
    let body: Buffer;
    try {
      const exported = await exportAllStaffAttendance(container, actorOf(c), query.data.month);
      body = await buildAttendanceWorkbook(allStaffWorkbookSheets(exported));
    } finally {
      bulkExportsInFlight--;
    }
    return xlsxResponse(
      c,
      body,
      `出勤簿_${yearMonthLabel(query.data.month)}_全員.xlsx`,
      `attendance_${query.data.month}_all.xlsx`,
    );
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
