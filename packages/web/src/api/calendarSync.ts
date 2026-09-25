import { calendarSyncApplyResponseSchema, calendarSyncPreviewResponseSchema } from '@katahimo/shared';
import { api } from './client';

/** カレンダー → 出勤簿の反映(doc/api/attendance-batch.md「カレンダー → 出勤簿」)。 */
export const calendarSyncApi = {
  /** GET /api/attendance/day/calendar-sync/preview: 書き込まずに差分だけを見る。GAS版 previewCalendarSyncForStaffOnDate。 */
  preview: (params: { date: string; staffId?: string }, signal?: AbortSignal) =>
    api.get('/api/attendance/day/calendar-sync/preview', calendarSyncPreviewResponseSchema, params, {
      signal,
    }),

  /** POST /api/attendance/day/calendar-sync: カレンダーの内容を出勤簿へ取り込む(冪等)。GAS版 applyCalendarSyncForStaffOnDate。 */
  apply: (body: { date: string; staffId?: string }) =>
    api.post('/api/attendance/day/calendar-sync', calendarSyncApplyResponseSchema, body),
};
