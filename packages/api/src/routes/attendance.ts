import {
  getAttendanceDay,
  getAttendanceMonth,
  getAttendanceScheduleEvents,
  saveAttendanceDay,
} from '@katahimo/core';
import type { AttendanceRowData } from '@katahimo/core/domain';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession, resolveAttendanceTargetStaffId } from '../session';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;
/** 1リクエストで取得できる日数の上限。GAS版PastSchedule.jsのPAST_SCHEDULE_WEEK_MAX_DAYSと同じ考え方。 */
const WEEK_RANGE_MAX_DAYS = 31;

/**
 * AttendanceRowDataとして受け付けてよいキーの一覧(出勤簿テンプレートの入力列のみ)。
 * ここに無いキー(派生値・数式に相当する列)はリクエストボディに含まれていても無視する。
 * PastSchedule.js の PAST_SCHEDULE_INPUT_COLUMNS と同じ「書き込んでよい列」の考え方。
 */
const ROW_DATA_KEYS = [
  'C',
  'D',
  'E',
  'H',
  'I',
  'L',
  'M',
  'N',
  'Q',
  'R',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'AA',
  'AB',
  'AC',
  'AG',
  'AH',
  'AI',
  'AJ',
  'AN',
  'AO',
] as const;

function sanitizeRowData(input: unknown): AttendanceRowData {
  const result: AttendanceRowData = {};
  if (!input || typeof input !== 'object') return result;
  const record = input as Record<string, unknown>;
  for (const key of ROW_DATA_KEYS) {
    const value = record[key];
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}

export function createAttendanceRoutes(container: Container) {
  const app = new Hono();

  /**
   * 指定日の勤怠(入力列+派生値)を取得する。staffIdクエリは管理者だけが有効
   * (resolveAttendanceTargetStaffId参照)。
   */
  app.get('/day', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const date = c.req.query('date');
    if (!date || !DATE_PATTERN.test(date)) {
      return c.json(
        { code: 'validation_failed', message: 'date(YYYY-MM-DD)クエリパラメータが必要です' },
        400,
      );
    }

    const staffId = resolveAttendanceTargetStaffId(session, c.req.query('staffId'));
    const result = await getAttendanceDay(container, session.tenantId, staffId, date);
    return c.json({ attendance: result });
  });

  /** 指定日の入力列を丸ごと保存する。 */
  app.put('/day', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = await c.req.json().catch(() => null);
    const date = body?.date;
    if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
      return c.json({ code: 'validation_failed', message: 'date(YYYY-MM-DD)が必要です' }, 400);
    }

    const staffId = resolveAttendanceTargetStaffId(session, body?.staffId);
    const rowData = sanitizeRowData(body?.rowData);
    const result = await saveAttendanceDay(container, session.tenantId, staffId, date, rowData);
    return c.json({ attendance: result });
  });

  /** 指定月('YYYY-MM')の勤怠を集計して返す。 */
  app.get('/month', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const yearMonth = c.req.query('month');
    if (!yearMonth || !YEAR_MONTH_PATTERN.test(yearMonth)) {
      return c.json({ code: 'validation_failed', message: 'month(YYYY-MM)クエリパラメータが必要です' }, 400);
    }

    const staffId = resolveAttendanceTargetStaffId(session, c.req.query('staffId'));
    const result = await getAttendanceMonth(container, session.tenantId, staffId, yearMonth);
    return c.json({ month: result });
  });

  /**
   * 指定期間('YYYY-MM-DD'両端含む)の勤怠を、週間予定UI(Googleカレンダー風表示)用の
   * イベント配列として返す。実際のGoogleカレンダーからではなく、保存済みの出勤簿の記録を
   * そのままイベント化しているだけの閲覧専用API(GAS版PastSchedule.jsのgetWeeklyScheduleForStaff
   * と同じ設計)。
   */
  app.get('/week', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const start = c.req.query('start');
    const end = c.req.query('end');
    if (!start || !end || !DATE_PATTERN.test(start) || !DATE_PATTERN.test(end)) {
      return c.json(
        { code: 'validation_failed', message: 'start・end(YYYY-MM-DD)クエリパラメータが必要です' },
        400,
      );
    }
    const dayCount = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1;
    if (Number.isNaN(dayCount) || dayCount < 1 || dayCount > WEEK_RANGE_MAX_DAYS) {
      return c.json(
        {
          code: 'validation_failed',
          message: `取得できる日数の上限(${WEEK_RANGE_MAX_DAYS}日)を超えています`,
        },
        400,
      );
    }

    const staffId = resolveAttendanceTargetStaffId(session, c.req.query('staffId'));
    const events = await getAttendanceScheduleEvents(container, session.tenantId, staffId, start, end);
    return c.json({ events });
  });

  return app;
}
