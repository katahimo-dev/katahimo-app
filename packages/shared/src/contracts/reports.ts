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
  /** 画面のお知らせに出す文言(GAS版 saveReport の message。いまは「保存しました」) */
  message: z.string().optional(),
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

/**
 * POST /api/reports/daily/generate・/accident/generate のリクエスト(GAS版 generateReportWithWarnings /
 * generateAccidentReport の引数)。start/end は 'HH:mm'。
 */
export const generateReportRequestSchema = z.object({
  text: z.string().trim().min(1, 'text が必要です'),
  start: z.string().optional(),
  end: z.string().optional(),
});
export type GenerateReportRequest = z.infer<typeof generateReportRequestSchema>;

/**
 * POST /api/reports/daily/generate の応答。失敗してもエラーにはせず、warnings に 'API Error' /
 * 'API Key Missing' を入れ、internal に理由を書いた同じ形を返す(GAS版と同じ)。
 */
export const dailyReportDraftSchema = z.object({
  warnings: z.array(z.string()),
  internal: z.string(),
  customer: z.string(),
});
export type DailyReportDraft = z.infer<typeof dailyReportDraftSchema>;
export const generateDailyReportResponseSchema = z.object({ draft: dailyReportDraftSchema });

/** POST /api/reports/accident/generate の応答。失敗時は draft が { error }(GAS版と同じ)。 */
export const accidentReportDraftSchema = z.object({
  occurrenceTime: z.string(),
  location: z.string(),
  accidentContent: z.string(),
  situation: z.string(),
  immediateResponse: z.string(),
  parentCorrespondence: z.string(),
  diagnosisTreatment: z.string(),
  prevention: z.string(),
});
export type AccidentReportDraft = z.infer<typeof accidentReportDraftSchema>;
export const generateAccidentReportResponseSchema = z.object({
  draft: z.union([accidentReportDraftSchema, z.object({ error: z.string() })]),
});

/** POST /api/reports/visit-complete(「訪問終わりました」の通知だけを送る。GAS版 sendVisitCompleteNotification) */
export const visitCompleteRequestSchema = z.object({
  staffId: idSchema.optional(),
  customerId: idSchema,
  visitDate: businessDateSchema,
  startTime: z.string(),
  endTime: z.string(),
});
export type VisitCompleteRequest = z.infer<typeof visitCompleteRequestSchema>;
export const visitCompleteResponseSchema = z.object({ success: z.literal(true) });
