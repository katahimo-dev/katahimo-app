import { z } from 'zod';
import { attendanceCellChangeSchema, attendanceRowDataSchema } from './attendance';
import { businessDateSchema, idSchema } from './common';

/**
 * カレンダー → 出勤簿の反映(GAS版 PastSchedule.js の previewCalendarSyncForStaffOnDate /
 * applyCalendarSyncForStaffOnDate / syncPastScheduleFromCalendar)。
 * 手入力の修正と違い、月ロック(当月のみ編集可)は適用しない(GAS版と同じ)。
 */

// ── GET /api/attendance/day/calendar-sync/preview ────────────

export const calendarSyncQuerySchema = z.object({
  date: businessDateSchema,
  staffId: idSchema.optional(),
});

export const calendarSyncPreviewResponseSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  date: businessDateSchema,
  appointmentCount: z.number().int(),
  hasChanges: z.boolean(),
  changes: z.array(attendanceCellChangeSchema),
});
export type CalendarSyncPreviewResponse = z.infer<typeof calendarSyncPreviewResponseSchema>;

// ── POST /api/attendance/day/calendar-sync ───────────────────

export const calendarSyncApplyRequestSchema = z.object({
  date: businessDateSchema,
  staffId: idSchema.optional(),
});

/**
 * 同じ日・同じスタッフに何度実行しても結果は同じ(冪等)。2回目以降は changedCount=0。
 * 管理者の期間一括反映は、クライアントがスタッフ×日ごとにこのAPIを順に呼ぶ(GAS版と同じ)。
 */
export const calendarSyncApplyResponseSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  date: businessDateSchema,
  appointmentCount: z.number().int(),
  changedCount: z.number().int(),
  changes: z.array(attendanceCellChangeSchema),
});
export type CalendarSyncApplyResponse = z.infer<typeof calendarSyncApplyResponseSchema>;

// ── POST /api/attendance/day/aggregate/refresh(管理者のみ) ──

/** GAS版 refreshAttendanceForStaffOnDate。「勤怠集計」シートの該当行をカレンダーから書き直す。 */
export const refreshAttendanceAggregateRequestSchema = z.object({
  date: businessDateSchema,
  staffId: idSchema,
});

export const refreshAttendanceAggregateResponseSchema = z.object({
  staffId: idSchema,
  staffName: z.string(),
  date: businessDateSchema,
  appointmentCount: z.number().int(),
  /** カレンダーから組み立てた出勤簿1日分(参考表示用。出勤簿自体は書き換えない)。 */
  rowData: attendanceRowDataSchema,
});
