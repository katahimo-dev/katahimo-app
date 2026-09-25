import { z } from 'zod';
import { businessDateSchema, idSchema } from './common';

const ratingSchema = z.number().int().min(1).max(5).nullable();
const textSchema = z.string().default('');

/**
 * POST /api/reports/daily
 * - staffIdは管理者のみ有効(他スタッフ名義で保存する場合)。管理者以外は常に本人になる。
 * - reportIdを渡すと既存日報の上書き保存。管理者以外は本人の日報しか上書きできない。
 */
export const saveDailyReportRequestSchema = z.object({
  reportId: idSchema.optional(),
  staffId: idSchema.optional(),
  customerId: idSchema,
  /** 訪問日。省略時は保存時刻を記録日時にする(GAS版saveReportと同じ)。 */
  reportDate: businessDateSchema.optional(),
  startTime: textSchema,
  endTime: textSchema,
  inputText: textSchema,
  internalText: textSchema,
  customerText: textSchema,
  riskRating: ratingSchema.default(null),
  esRating: ratingSchema.default(null),
});
export type SaveDailyReportRequest = z.infer<typeof saveDailyReportRequestSchema>;

export const dailyReportViewSchema = z.object({
  id: idSchema,
  occurredAt: z.string(),
  staffId: idSchema,
  customerId: idSchema,
  riskRating: ratingSchema,
  esRating: ratingSchema,
  content: z.object({
    startTime: z.string(),
    endTime: z.string(),
    inputText: z.string(),
    internalText: z.string(),
    customerText: z.string(),
  }),
});
export const saveDailyReportResponseSchema = z.object({
  success: z.literal(true),
  report: dailyReportViewSchema,
});

/** POST /api/reports/accident (staffId/reportIdの扱いは日報と同じ) */
export const saveAccidentReportRequestSchema = z.object({
  reportId: idSchema.optional(),
  staffId: idSchema.optional(),
  customerId: idSchema,
  reportType: z.enum(['事故報告', 'ヒヤリハット']).default('事故報告'),
  targetName: textSchema,
  targetDob: textSchema,
  occurrenceTime: textSchema,
  location: textSchema,
  accidentContent: textSchema,
  situation: textSchema,
  immediateResponse: textSchema,
  parentCorrespondence: textSchema,
  diagnosisTreatment: textSchema,
  prevention: textSchema,
  inputText: textSchema,
});
export type SaveAccidentReportRequest = z.infer<typeof saveAccidentReportRequestSchema>;

export const accidentReportViewSchema = z.object({
  id: idSchema,
  occurredAt: z.string(),
  staffId: idSchema,
  customerId: idSchema,
  reportType: z.string(),
  content: z.record(z.string(), z.string()),
});
export const saveAccidentReportResponseSchema = z.object({
  success: z.literal(true),
  report: accidentReportViewSchema,
});
