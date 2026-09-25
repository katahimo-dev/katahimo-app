import { buildScheduleEventsFromRowData, type ScheduleEvent } from '../../domain/attendance';
import { countDaysInclusive, isValidBusinessDate } from '../../domain/calendarDate';
import { type AttendanceActor, loadAttendanceTarget, logCrossStaffRead } from './access';
import type { AttendanceDeps } from './deps';
import { AttendanceError } from './errors';
import { readRowData } from './records';

/** 1リクエストで取得できる日数の上限(GAS版 PAST_SCHEDULE_WEEK_MAX_DAYS)。 */
export const ATTENDANCE_EVENTS_MAX_DAYS = 31;

/**
 * 指定期間(両端含む)の出勤簿の記録を、週間予定UI用のイベント配列にする(GAS版 getWeeklyScheduleForStaff)。
 * Googleカレンダーではなく出勤簿の記録内容を表示する閲覧専用のビュー。日付順・枠順に並ぶ。
 */
export async function getAttendanceScheduleEvents(
  deps: AttendanceDeps,
  actor: AttendanceActor,
  targetStaffId: string,
  startDate: string,
  endDate: string,
): Promise<ScheduleEvent[]> {
  if (!isValidBusinessDate(startDate) || !isValidBusinessDate(endDate) || endDate < startDate) {
    throw new AttendanceError('invalid_request', '日付範囲が不正です。');
  }
  if (countDaysInclusive(startDate, endDate) > ATTENDANCE_EVENTS_MAX_DAYS) {
    throw new AttendanceError(
      'invalid_request',
      `一度に取得できる日数の上限(${ATTENDANCE_EVENTS_MAX_DAYS}日)を超えています。`,
    );
  }
  const target = await loadAttendanceTarget(deps, actor, targetStaffId);

  const records = await deps.attendanceDays.listByStaffAndDateRange(
    actor.tenantId,
    target.staffId,
    startDate,
    endDate,
  );
  const sorted = [...records].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const events: ScheduleEvent[] = [];
  for (const record of sorted) {
    events.push(
      ...buildScheduleEventsFromRowData(record.businessDate, await readRowData(deps, actor.tenantId, record)),
    );
  }

  await logCrossStaffRead(deps, actor, target, 'attendance.week.view', {
    startDate,
    endDate,
    eventCount: events.length,
  });
  return events;
}
