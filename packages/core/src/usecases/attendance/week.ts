import {
  buildScheduleEventsFromRowData,
  countDaysInclusive,
  invalid,
  isValidBusinessDate,
  projectDay,
  type ScheduleEvent,
} from '../../domain';
import type { Actor } from '../requestMeta';
import { loadAttendanceTarget, logCrossStaffRead } from './access';
import type { AttendanceDeps } from './deps';
import { toSheetDay } from './records';

/** 1リクエストで取得できる日数の上限(GAS版 PAST_SCHEDULE_WEEK_MAX_DAYS)。 */
export const ATTENDANCE_EVENTS_MAX_DAYS = 31;

/**
 * 指定期間(両端含む)の出勤簿の記録を、週間予定の画面用のイベントにする(GAS版 getWeeklyScheduleForStaff)。
 * Googleカレンダーではなく出勤簿の記録をそのまま表示する閲覧専用のビュー。日付順・枠順に並ぶ。
 */
export async function getAttendanceScheduleEvents(
  deps: AttendanceDeps,
  actor: Actor,
  targetStaffId: string,
  startDate: string,
  endDate: string,
): Promise<ScheduleEvent[]> {
  if (!isValidBusinessDate(startDate) || !isValidBusinessDate(endDate) || endDate < startDate) {
    throw invalid('日付範囲が不正です。');
  }
  if (countDaysInclusive(startDate, endDate) > ATTENDANCE_EVENTS_MAX_DAYS) {
    throw invalid(`一度に取得できる日数の上限(${ATTENDANCE_EVENTS_MAX_DAYS}日)を超えています。`);
  }
  const { target, events } = await deps.uow.run(actor.tenantId, async (r) => {
    const target = await loadAttendanceTarget(r, actor, targetStaffId);
    const timeZone = (await r.tenant()).timezone;
    const events: ScheduleEvent[] = [];
    for (const rows of await r.attendance.loadRange(target.staffId, startDate, endDate)) {
      const sheet = await toSheetDay(deps.crypto, r.tenantId, timeZone, rows);
      events.push(...buildScheduleEventsFromRowData(rows.businessDate, projectDay(sheet).rowData));
    }
    return { target, events };
  });
  await logCrossStaffRead(deps.appLog, actor, target, 'attendance.week.view', {
    startDate,
    endDate,
    eventCount: events.length,
  });
  return events;
}
