import { z } from 'zod';
import { businessDateSchema, idSchema, yearMonthSchema } from './common';

/**
 * 出勤簿1日分の入力列のキー(出勤簿スプレッドシートの列記号)。
 *
 * attendance_days.row_data のJSONキー・APIのrowDataキー・GAS版Bridge.jsへのミラーペイロードの
 * キーはすべてこの列記号で統一している(doc/03_データベース設計.md 3.3)。各列が業務上何を意味するか
 * (訪問#1の始業時刻、#1→#2の移動距離…)の対応づけは packages/core/src/domain/attendance/sheetLayout.ts
 * だけが持ち、業務ロジックはそちらの名前付き定義を経由して列にアクセスする。
 */
export const ATTENDANCE_COLUMN_KEYS = [
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
export type AttendanceColumnKey = (typeof ATTENDANCE_COLUMN_KEYS)[number];

/** セル1つ分の入力値。数値で送られてきても文字列として保存する(GAS版の String() 比較と揃える)。 */
const cellValueSchema = z
  .union([z.string().max(2000), z.number().finite()])
  .transform((value) => String(value));

const rowDataShape = Object.fromEntries(
  ATTENDANCE_COLUMN_KEYS.map((key) => [key, cellValueSchema.optional()]),
) as Record<AttendanceColumnKey, z.ZodOptional<typeof cellValueSchema>>;

/** rowData。列記号以外のキー(派生値など)は取り除く。 */
export const attendanceRowDataSchema = z.object(rowDataShape).strip();
export type AttendanceRowDataInput = z.input<typeof attendanceRowDataSchema>;

const numberOrBlankSchema = z.union([z.number(), z.literal('')]);

export const attendanceDayDerivedSchema = z.object({
  leg1MoveStart: z.string(),
  leg1MoveEnd: z.string(),
  leg1WeatherAdjustedMoveMin: numberOrBlankSchema,
  leg1WaitMin: numberOrBlankSchema,
  leg2MoveStart: z.string(),
  leg2MoveEnd: z.string(),
  leg2WeatherAdjustedMoveMin: numberOrBlankSchema,
  leg2WaitMin: numberOrBlankSchema,
  laborMinutes: z.number(),
  overtimeMinutes: z.number(),
  workedMinutes: z.number(),
  totalMoveMin: z.number(),
  totalDistanceKm: z.number(),
  overThresholdCount: z.number(),
  visitCount: z.number(),
});

export const attendanceMonthlyTotalsSchema = z.object({
  laborMinutes: z.number(),
  overtimeMinutes: z.number(),
  workedMinutes: z.number(),
  totalMoveMin: z.number(),
  leg1DistanceKmTotal: z.number(),
  leg2DistanceKmTotal: z.number(),
  attendanceDistanceKmTotal: z.number(),
  leavingDistanceKmTotal: z.number(),
  totalDistanceKm: z.number(),
  overThresholdCount: z.number(),
  visitCountTotal: z.number(),
  shoppingErrandTotal: z.number(),
});

/** 管理者・コーディネーターだけが有効な「対象スタッフ」指定(一般スタッフが送っても無視され本人に固定される)。 */
const targetStaffIdSchema = idSchema.optional();

// ── GET /api/attendance/day ──────────────────────────────────

export const attendanceDayQuerySchema = z.object({
  date: businessDateSchema,
  staffId: targetStaffIdSchema,
});

export const attendanceDaySchema = z.object({
  businessDate: businessDateSchema,
  staffId: idSchema,
  staffName: z.string(),
  /** 出勤簿の記録が存在するか(false の場合 rowData は空)。GAS版「記録が出勤簿に見つかりません」に相当。 */
  found: z.boolean(),
  rowData: attendanceRowDataSchema,
  derived: attendanceDayDerivedSchema,
  /** 自動転記後に手で変更された列(GAS版で背景色 #fce4e4 が付くセル)。 */
  changedFields: z.array(z.string()),
  /** 楽観的排他の版(記録の無い日は0)。更新のときに送り返すと、他の人の保存と重なった場合に 409 になる。 */
  rowVersion: z.number().int().nonnegative(),
  /** 当月(JST)の日付だけ編集できる(GAS版 updatePastSchedule の月ロック)。 */
  editable: z.boolean(),
  editableFrom: businessDateSchema,
  editableTo: businessDateSchema,
  /** 天候(#1後 / #2後)の選択肢。GAS版はシートの入力規則から読んでいた。 */
  optionsI: z.array(z.string()),
  optionsR: z.array(z.string()),
});
export type AttendanceDay = z.infer<typeof attendanceDaySchema>;

export const attendanceDayResponseSchema = z.object({ attendance: attendanceDaySchema });

// ── PUT /api/attendance/day ──────────────────────────────────

/** 送られてきた列だけを比較・更新する(送られていない列はそのまま)。 */
export const updateAttendanceDayRequestSchema = z.object({
  date: businessDateSchema,
  staffId: targetStaffIdSchema,
  rowData: attendanceRowDataSchema,
  /** 画面が読んだ版(GET の rowVersion)。送れば、他の人が先に保存していた場合に 409 conflict。 */
  rowVersion: z.number().int().nonnegative().optional(),
});
export type UpdateAttendanceDayRequest = z.infer<typeof updateAttendanceDayRequestSchema>;

export const attendanceCellChangeSchema = z.object({
  column: z.string(),
  label: z.string(),
  oldValue: z.string(),
  newValue: z.string(),
});
export type AttendanceCellChange = z.infer<typeof attendanceCellChangeSchema>;

export const updateAttendanceDayResponseSchema = z.object({
  attendance: attendanceDaySchema,
  changedCount: z.number().int(),
  changedColumns: z.array(z.string()),
  /** '修正しました。' / '変更はありませんでした。'(GAS版と同じ文言) */
  message: z.string(),
});

// ── GET /api/attendance/month ────────────────────────────────

export const attendanceMonthQuerySchema = z.object({
  month: yearMonthSchema,
  staffId: targetStaffIdSchema,
});

export const attendanceMonthDaySchema = z.object({
  businessDate: businessDateSchema,
  rowData: attendanceRowDataSchema,
  derived: attendanceDayDerivedSchema,
});

export const attendanceMonthSchema = z.object({
  yearMonth: yearMonthSchema,
  staffId: idSchema,
  staffName: z.string(),
  /** 月の全日分(記録の無い日は空のrowData)。 */
  days: z.array(attendanceMonthDaySchema),
  totals: attendanceMonthlyTotalsSchema,
  /** 領収書の金額集計(日別・月合計)。GAS版 getReceiptsForMonth_ に相当。 */
  receipts: z.object({
    byDay: z.record(businessDateSchema, z.number()),
    total: z.number(),
  }),
});
export type AttendanceMonth = z.infer<typeof attendanceMonthSchema>;

export const attendanceMonthResponseSchema = z.object({ month: attendanceMonthSchema });

// ── GET /api/attendance/week ─────────────────────────────────

/** 1リクエストで取得できる日数の上限(GAS版 PAST_SCHEDULE_WEEK_MAX_DAYS)。 */
export const ATTENDANCE_WEEK_MAX_DAYS = 31;

export const attendanceWeekQuerySchema = z.object({
  start: businessDateSchema,
  end: businessDateSchema,
  staffId: targetStaffIdSchema,
});

export const attendanceScheduleEventSchema = z.object({
  date: businessDateSchema,
  slotKey: z.enum(['slot1', 'slot2', 'slot3', 'office1', 'office2']),
  title: z.string(),
  eventType: z.enum(['CUSTOMER APPOINTMENT', 'OFFICE WORK']),
  start: z.string(),
  end: z.string(),
});

export const attendanceWeekResponseSchema = z.object({
  events: z.array(attendanceScheduleEventSchema),
});
