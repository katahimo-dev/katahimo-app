import {
  type AttendanceRowDataInput,
  attendanceDayResponseSchema,
  attendanceMonthResponseSchema,
  attendanceWeekResponseSchema,
  updateAttendanceDayResponseSchema,
} from '@katahimo/shared';
import { api } from './client';

/**
 * 出勤簿のAPI(doc/04_API仕様.md 2.5)。`staffId` は管理者が他のスタッフを見るときだけ渡す
 * (管理者以外は undefined = 本人。サーバーも管理者以外の staffId は無視する)。
 */
export const attendanceApi = {
  /** GET /api/attendance/week: 週間予定(出勤簿の記録をイベントにしたもの)。GAS版 getWeeklyScheduleForStaff。 */
  getWeek: (params: { start: string; end: string; staffId?: string }, signal?: AbortSignal) =>
    api.get('/api/attendance/week', attendanceWeekResponseSchema, params, { signal }),

  /** GET /api/attendance/day: 1日分の出勤簿。GAS版 getPastScheduleForDate。 */
  getDay: (params: { date: string; staffId?: string }, signal?: AbortSignal) =>
    api.get('/api/attendance/day', attendanceDayResponseSchema, params, { signal }),

  /** PUT /api/attendance/day: 送った列だけを直す。当月以外は 400 locked。GAS版 updatePastSchedule。 */
  updateDay: (body: { date: string; staffId?: string; rowData: AttendanceRowDataInput }) =>
    api.put('/api/attendance/day', updateAttendanceDayResponseSchema, body),

  /** GET /api/attendance/month: 月のまとめ(全日・合計・領収書)。GAS版 getAttendanceMonth。 */
  getMonth: (params: { month: string; staffId?: string }, signal?: AbortSignal) =>
    api.get('/api/attendance/month', attendanceMonthResponseSchema, params, { signal }),
};
