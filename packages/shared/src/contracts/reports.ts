import { z } from 'zod';
import { businessDateSchema, freeText, idSchema, recordDateSchema } from './common';

const ratingSchema = z.number().int().min(1).max(5).nullable();
const textSchema = freeText(z.string().default(''));

/**
 * POST /api/reports/daily
 * - staffIdは管理者のみ有効(他スタッフ名義で保存する場合)。管理者以外は常に本人になる。
 * - reportIdを渡すと既存日報の上書き保存。管理者以外は本人の日報しか上書きできない。
 */
const rowVersionSchema = z.number().int().positive();

export const saveDailyReportRequestSchema = z.object({
  reportId: idSchema.optional(),
  /** 上書きのとき、画面が読んだ記録の版(送れば、他の人が先に保存していた場合に 409)。 */
  rowVersion: rowVersionSchema.optional(),
  staffId: idSchema.optional(),
  customerId: idSchema,
  /** 訪問日。省略時は保存時刻を記録日時にする(GAS版saveReportと同じ)。実在する 2000〜2100年の日付だけ。 */
  reportDate: recordDateSchema.optional(),
  startTime: textSchema,
  endTime: textSchema,
  inputText: textSchema,
  internalText: textSchema,
  customerText: textSchema,
  riskRating: ratingSchema.default(null),
  esRating: ratingSchema.default(null),
  /** 日報の対象のお子様(お客様の世帯の子。未選択は省略)。 */
  careRecipientId: idSchema.nullable().optional(),
  /**
   * この日報の下書きを作った AI 生成の記録(generate の応答の generationId)。同じスタッフ・同じお客様の生成だけを
   * 結び付ける(違えば 400)。AI を使わずに書いたときは省略。
   */
  aiGenerationId: idSchema.optional(),
});
export type SaveDailyReportRequest = z.infer<typeof saveDailyReportRequestSchema>;

export const dailyReportViewSchema = z.object({
  id: idSchema,
  occurredAt: z.string(),
  staffId: idSchema,
  customerId: idSchema,
  riskRating: ratingSchema,
  esRating: ratingSchema,
  careRecipientId: idSchema.nullable(),
  /** PSI 2 以下(注意・危険)で保存したため管理者へ知らせた。 */
  psiAlert: z.boolean(),
  rowVersion: rowVersionSchema,
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
  rowVersion: rowVersionSchema.optional(),
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
  rowVersion: rowVersionSchema,
  content: z.record(z.string(), z.string()),
});
export const saveAccidentReportResponseSchema = z.object({
  success: z.literal(true),
  report: accidentReportViewSchema,
});

/**
 * POST /api/reports/accident/generate のリクエスト(GAS版 generateAccidentReport の引数)。start/end は 'HH:mm'。
 */
export const generateReportRequestSchema = z.object({
  text: freeText(z.string().trim().min(1, 'text が必要です').max(20_000, 'メモが長すぎます')),
  start: z.string().optional(),
  end: z.string().optional(),
});
export type GenerateReportRequest = z.infer<typeof generateReportRequestSchema>;

/**
 * POST /api/reports/daily/generate のリクエスト(GAS版 generateReportWithWarnings の引数 + 日報AIの3軸)。
 * - customerId: 日報を書くお客様(家庭の教育思考★を読む)
 * - careRecipientId: 対象のお子様(月齢 → 年齢帯。未選択なら年齢帯の言葉を使わない)
 * - riskRating: 生成の前に付けた PSI(未評価は省略。言葉の絞り込みは PSI 4 = 通常運用として扱う)
 * - reportDate: 訪問日(月齢を数える日。省略時はテナントの今日)
 */
export const generateDailyReportRequestSchema = generateReportRequestSchema.extend({
  customerId: idSchema,
  careRecipientId: idSchema.nullable().optional(),
  riskRating: z.number().int().min(1).max(5).nullable().optional(),
  reportDate: businessDateSchema.optional(),
});
export type GenerateDailyReportRequest = z.input<typeof generateDailyReportRequestSchema>;

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

/** AI が使ったと答えた教育キーワード(表に無い答えは known=false で、そのまま出す)。 */
export const usedReportKeywordSchema = z.object({
  code: z.string(),
  keyword: z.string().nullable(),
  known: z.boolean(),
});
export type UsedReportKeyword = z.infer<typeof usedReportKeywordSchema>;

export const dailyReportAiInfoSchema = z.object({
  /** 生成の記録(保存のときに aiGenerationId として送る)。記録できなかったときは null。 */
  generationId: idSchema.nullable(),
  usedKeywords: z.array(usedReportKeywordSchema),
  /** 候補として AI に見せたキーワードの数。 */
  candidateCount: z.number().int(),
  /** PSI 1(危険・緊急): 文面より安全対応を最優先し、管理者へ連絡する。 */
  escalationRequired: z.boolean(),
  /** 対象のお子様の月齢(訪問日の時点。未選択・生年月日不明は null)。 */
  childAgeMonths: z.number().int().nullable(),
  /** 家庭の教育思考★(未設定は既定の★2)。 */
  educationLevel: z.number().int(),
  /** PSI で調整したあとの★(PSI 2 以下は教育語を使わないので null)。 */
  effectiveEducationLevel: z.number().int().nullable(),
});
export type DailyReportAiInfo = z.infer<typeof dailyReportAiInfoSchema>;
export const generateDailyReportResponseSchema = z.object({
  draft: dailyReportDraftSchema,
  ai: dailyReportAiInfoSchema,
});

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
