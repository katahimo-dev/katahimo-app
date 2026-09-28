import { z } from 'zod';
import { businessDateSchema, freeText, idSchema } from './common';

/**
 * 日報AIの調整(年齢帯 × 教育思考★ × PSI の3軸)の区分値・契約。
 * 設定の元はお客様の「日報キーワード表現マスター」(シート 01〜06)。3軸の意味と組み立ての規則は
 * doc/02_機能仕様.md の日報の章、組み立ての実装は core/domain/reports/promptAssembly.ts。
 */

/** 教育思考★・PSI の段階(1〜5)。 */
export const REPORT_LEVEL_MIN = 1;
export const REPORT_LEVEL_MAX = 5;
export const REPORT_LEVELS = [1, 2, 3, 4, 5] as const;

/** 教育思考★が未設定の家庭に使う★(シート03 の「★2 標準」。お客様の変更案の「未入力なら eduLevel=2」)。 */
export const DEFAULT_EDUCATION_LEVEL = 2;
/** PSI が未評価の訪問で、言葉を絞り込むときに使う PSI(お客様の変更案の「未入力なら psi=4(通常運用)」)。 */
export const DEFAULT_PSI_FOR_PROMPT = 4;
/** 保存したときに管理者へ知らせる PSI の上限(2=注意、1=危険・緊急)。 */
export const PSI_ALERT_MAX = 2;
/** PSI 1(危険・緊急)は安全対応を最優先し、管理者へ連絡する。 */
export const PSI_ESCALATION_LEVEL = 1;

/** 管理者へ知らせる PSI か(日報の保存・報告一覧の印)。 */
export function isPsiAlert(riskRating: number | null | undefined): boolean {
  return typeof riskRating === 'number' && riskRating >= REPORT_LEVEL_MIN && riskRating <= PSI_ALERT_MAX;
}

/** 表現(シート05)の区分。warm = ◎使う(温かみ表現)/ avoid = ✕避ける(全ての日報で使わない)。 */
export const REPORT_PHRASE_KINDS = ['warm', 'avoid'] as const;
export type ReportPhraseKind = (typeof REPORT_PHRASE_KINDS)[number];
export const REPORT_PHRASE_KIND_LABELS: Record<ReportPhraseKind, string> = {
  warm: '◎使う',
  avoid: '✕避ける',
};

/**
 * 用語名(専門用語そのもの)の扱い(シート03「用語名の扱い」を機械的に使える形にしたもの)。
 * forbid = 出さない(用語名NG・出さない)/ sparing = 控えめ(概念は説明、用語名は控えめ)/
 * allow = 出してよい(必ず親向け説明とセット)。
 */
export const TERM_NAME_POLICIES = ['forbid', 'sparing', 'allow'] as const;
export type TermNamePolicy = (typeof TERM_NAME_POLICIES)[number];
export const TERM_NAME_POLICY_LABELS: Record<TermNamePolicy, string> = {
  forbid: '出さない',
  sparing: '控えめ',
  allow: '説明とセットで出す',
};

/** 1通あたりの教育語の上限(シート06「分量」・STEP4「1通あたり1〜2語まで」)。★の定義が多く書いてもこれで止める。 */
export const MAX_KEYWORDS_PER_REPORT = 2;
/** プロンプトに載せるキーワードの候補の上限(多すぎると AI が詰め込むため)。 */
export const MAX_KEYWORD_CANDIDATES = 10;
/** 月齢の上限(取込・入力の値の範囲。12歳)。 */
export const AGE_MONTHS_MAX = 144;

const shortText = (max: number) => freeText(z.string().trim().max(max));
const optionalText = (max: number) =>
  freeText(z.string().trim().max(max).nullable())
    .optional()
    .transform((v) => (v ? v : null));
const level = z.number().int().min(REPORT_LEVEL_MIN).max(REPORT_LEVEL_MAX);
const months = z.number().int().min(0).max(AGE_MONTHS_MAX);
const sortOrder = z.number().int().min(0).max(100_000).default(0);
const rowVersion = z.number().int().positive();

/** キーワードのID(シート01 の「ID」。K01 など)。 */
export const reportKeywordCodeSchema = z
  .string()
  .trim()
  .min(1, 'IDを入力してください')
  .max(20, 'IDは20文字までにしてください')
  .regex(/^[A-Za-z0-9_-]+$/, 'IDは半角英数字(K01 など)にしてください')
  .transform((code) => code.toUpperCase());

// ── キーワード(シート01) ──
export const reportKeywordInputSchema = z
  .object({
    code: reportKeywordCodeSchema,
    category: optionalText(100),
    keyword: shortText(100).pipe(z.string().min(1, 'キーワードを入力してください')),
    subConcept: optionalText(200),
    /** 対象年齢(表示)。「3〜6歳」など、画面・プロンプトに出す表記。 */
    ageLabel: optionalText(50),
    /** 年齢下限(月齢。含む)。 */
    ageFromMonths: months,
    /** 年齢上限(月齢。含む。シート01 の「対象月齢 ∈ [列F, 列G]」)。 */
    ageToMonths: months,
    /** 適用年齢帯(表示)。「3・4・5・6歳」「全年齢」など。 */
    ageBandLabel: optionalText(100),
    /** 教育思考レベル適用★の下限・上限(「4-5」なら 4〜5)。 */
    educationLevelMin: level,
    educationLevelMax: level,
    /** PSI下限(この値以上で使用可)。 */
    psiMin: level,
    tone: optionalText(50),
    /** 親向け説明(やさしい言い換え)。用語名を出すときは必ずこれとセットにする。 */
    parentExplanation: optionalText(1000),
    /** 日報フレーズ例(見ていた人スタンス)。改行区切りで複数。 */
    phraseExamples: optionalText(3000),
    usageScene: optionalText(500),
    /** この語でのNG例(避ける上から目線)。 */
    ngExample: optionalText(500),
    sortOrder,
  })
  .refine((k) => k.ageFromMonths <= k.ageToMonths, {
    message: '年齢の下限は上限以下にしてください',
    path: ['ageToMonths'],
  })
  .refine((k) => k.educationLevelMin <= k.educationLevelMax, {
    message: '★の下限は上限以下にしてください',
    path: ['educationLevelMax'],
  });
export type ReportKeywordInput = z.output<typeof reportKeywordInputSchema>;

// ── 年齢帯(シート02) ──
export const reportAgeBandInputSchema = z
  .object({
    /** 年齢帯(「0-6ヶ月」「1歳」など)。取込で突き合わせるキー。 */
    label: shortText(50).pipe(z.string().min(1, '年齢帯を入力してください')),
    /** 月齢範囲の下限(含む)。 */
    ageFromMonths: months,
    /** 月齢範囲の上限(含まない。「0〜6ヶ月」「6〜12ヶ月」の境目の6ヶ月は次の帯)。 */
    ageToMonths: months,
    behaviorWords: optionalText(1000),
    developmentTopics: optionalText(1000),
    /** 相性の良いキーワードID(並びの順に候補の先頭に寄せる)。 */
    keywordCodes: z.array(reportKeywordCodeSchema).max(30).default([]),
    sceneExamples: optionalText(500),
    sortOrder,
  })
  .refine((b) => b.ageFromMonths < b.ageToMonths, {
    message: '月齢範囲の下限は上限より小さくしてください',
    path: ['ageToMonths'],
  });
export type ReportAgeBandInput = z.output<typeof reportAgeBandInputSchema>;

// ── 教育思考★(シート03) ──
export const reportEducationLevelInputSchema = z
  .object({
    level,
    /** 呼称(「標準」など)。 */
    label: optionalText(50),
    customerProfile: optionalText(500),
    /** 教育語の使い方。 */
    usage: optionalText(500),
    /** 使ってよい語の範囲。 */
    wordScope: optionalText(500),
    /** 用語名の扱い(表の文言)。 */
    termNameRule: optionalText(200),
    termNamePolicy: z.enum(TERM_NAME_POLICIES),
    /** 1通あたり教育語の下限・上限(「0〜1個」なら 0〜1)。 */
    keywordsMin: z.number().int().min(0).max(9),
    keywordsMax: z.number().int().min(0).max(9),
    toneFocus: optionalText(200),
    exampleDirection: optionalText(500),
  })
  .refine((l) => l.keywordsMin <= l.keywordsMax, {
    message: '教育語の数の下限は上限以下にしてください',
    path: ['keywordsMax'],
  });
export type ReportEducationLevelInput = z.output<typeof reportEducationLevelInputSchema>;

// ── PSI(シート04) ──
export const reportPsiLevelInputSchema = z.object({
  level,
  /** 定義(「安心・良好」など)。 */
  label: shortText(50).pipe(z.string().min(1, '定義を入力してください')),
  /** 判定基準。 */
  criteria: optionalText(2000),
});
export type ReportPsiLevelInput = z.output<typeof reportPsiLevelInputSchema>;

// ── 表現(シート05) ──
export const reportPhraseInputSchema = z
  .object({
    kind: z.enum(REPORT_PHRASE_KINDS),
    /** 表現例/避ける言い回し。区分と合わせて取込で突き合わせるキー。 */
    body: shortText(500).pipe(z.string().min(1, '表現を入力してください')),
    /** 込めるメッセージ/理由。 */
    message: optionalText(500),
    /** 推奨PSIの範囲(避ける表現は常に 1〜5 = PSIに関わらず全ての日報)。 */
    psiMin: level,
    psiMax: level,
    note: optionalText(200),
    sortOrder,
  })
  .refine((p) => p.psiMin <= p.psiMax, { message: 'PSIの下限は上限以下にしてください', path: ['psiMax'] })
  .transform((p) => (p.kind === 'avoid' ? { ...p, psiMin: REPORT_LEVEL_MIN, psiMax: REPORT_LEVEL_MAX } : p));
export type ReportPhraseInput = z.output<typeof reportPhraseInputSchema>;

// ── 見ていた人スタンス(シート06) ──
export const reportStanceRuleInputSchema = z.object({
  /** 項目(「評価口調」など)。取込で突き合わせるキー。 */
  topic: shortText(50).pipe(z.string().min(1, '項目を入力してください')),
  /** ✕避ける(上から目線・評価)。 */
  avoidText: optionalText(500),
  /** ◎推奨(見ていた人・共感)。 */
  recommendedText: optionalText(500),
  reason: optionalText(500),
  sortOrder,
});
export type ReportStanceRuleInput = z.output<typeof reportStanceRuleInputSchema>;

const rowMeta = { id: idSchema, rowVersion, updatedAt: z.string() };
const nullable = z.string().nullable();

export const reportKeywordViewSchema = z.object({
  ...rowMeta,
  code: z.string(),
  category: nullable,
  keyword: z.string(),
  subConcept: nullable,
  ageLabel: nullable,
  ageFromMonths: z.number().int(),
  ageToMonths: z.number().int(),
  ageBandLabel: nullable,
  educationLevelMin: z.number().int(),
  educationLevelMax: z.number().int(),
  psiMin: z.number().int(),
  tone: nullable,
  parentExplanation: nullable,
  phraseExamples: nullable,
  usageScene: nullable,
  ngExample: nullable,
  sortOrder: z.number().int(),
});
export type ReportKeywordView = z.infer<typeof reportKeywordViewSchema>;

export const reportAgeBandViewSchema = z.object({
  ...rowMeta,
  label: z.string(),
  ageFromMonths: z.number().int(),
  ageToMonths: z.number().int(),
  behaviorWords: nullable,
  developmentTopics: nullable,
  keywordCodes: z.array(z.string()),
  sceneExamples: nullable,
  sortOrder: z.number().int(),
});
export type ReportAgeBandView = z.infer<typeof reportAgeBandViewSchema>;

export const reportEducationLevelViewSchema = z.object({
  ...rowMeta,
  level: z.number().int(),
  label: nullable,
  customerProfile: nullable,
  usage: nullable,
  wordScope: nullable,
  termNameRule: nullable,
  termNamePolicy: z.enum(TERM_NAME_POLICIES),
  keywordsMin: z.number().int(),
  keywordsMax: z.number().int(),
  toneFocus: nullable,
  exampleDirection: nullable,
});
export type ReportEducationLevelView = z.infer<typeof reportEducationLevelViewSchema>;

export const reportPsiLevelViewSchema = z.object({
  ...rowMeta,
  level: z.number().int(),
  label: z.string(),
  criteria: nullable,
});
export type ReportPsiLevelView = z.infer<typeof reportPsiLevelViewSchema>;

export const reportPhraseViewSchema = z.object({
  ...rowMeta,
  kind: z.enum(REPORT_PHRASE_KINDS),
  body: z.string(),
  message: nullable,
  psiMin: z.number().int(),
  psiMax: z.number().int(),
  note: nullable,
  sortOrder: z.number().int(),
});
export type ReportPhraseView = z.infer<typeof reportPhraseViewSchema>;

export const reportStanceRuleViewSchema = z.object({
  ...rowMeta,
  topic: z.string(),
  avoidText: nullable,
  recommendedText: nullable,
  reason: nullable,
  sortOrder: z.number().int(),
});
export type ReportStanceRuleView = z.infer<typeof reportStanceRuleViewSchema>;

/** GET /api/admin/report-ai(管理者だけ)。アーカイブした行は含めない。 */
export const reportAiMastersResponseSchema = z.object({
  keywords: z.array(reportKeywordViewSchema),
  ageBands: z.array(reportAgeBandViewSchema),
  educationLevels: z.array(reportEducationLevelViewSchema),
  psiLevels: z.array(reportPsiLevelViewSchema),
  phrases: z.array(reportPhraseViewSchema),
  stanceRules: z.array(reportStanceRuleViewSchema),
});
export type ReportAiMastersResponse = z.infer<typeof reportAiMastersResponseSchema>;

/**
 * 行ごとの編集の対象(URL の :kind)。levels(★・PSI)は段階が決まっている(1〜5)ため追加・削除は無く、
 * 段階ごとの上書き(無ければ作る)。
 */
export const REPORT_AI_ROW_KINDS = ['keywords', 'age-bands', 'phrases', 'stance-rules'] as const;
export type ReportAiRowKind = (typeof REPORT_AI_ROW_KINDS)[number];
export const REPORT_AI_LEVEL_KINDS = ['education-levels', 'psi-levels'] as const;
export type ReportAiLevelKind = (typeof REPORT_AI_LEVEL_KINDS)[number];

/** 更新・削除のときに画面が読んだ版(他の管理者が先に変えていれば 409)。 */
const withRowVersion = { rowVersion: rowVersion.optional() };

export const saveReportKeywordRequestSchema = z.object({
  row: reportKeywordInputSchema,
  ...withRowVersion,
});
export const saveReportAgeBandRequestSchema = z.object({
  row: reportAgeBandInputSchema,
  ...withRowVersion,
});
export const saveReportPhraseRequestSchema = z.object({ row: reportPhraseInputSchema, ...withRowVersion });
export const saveReportStanceRuleRequestSchema = z.object({
  row: reportStanceRuleInputSchema,
  ...withRowVersion,
});
export const saveReportEducationLevelRequestSchema = z.object({
  row: reportEducationLevelInputSchema,
  ...withRowVersion,
});
export const saveReportPsiLevelRequestSchema = z.object({
  row: reportPsiLevelInputSchema,
  ...withRowVersion,
});
export type SaveReportKeywordRequest = z.input<typeof saveReportKeywordRequestSchema>;
export type SaveReportAgeBandRequest = z.input<typeof saveReportAgeBandRequestSchema>;
export type SaveReportPhraseRequest = z.input<typeof saveReportPhraseRequestSchema>;
export type SaveReportStanceRuleRequest = z.input<typeof saveReportStanceRuleRequestSchema>;
export type SaveReportEducationLevelRequest = z.input<typeof saveReportEducationLevelRequestSchema>;
export type SaveReportPsiLevelRequest = z.input<typeof saveReportPsiLevelRequestSchema>;

/** 行を保存した結果(画面は一覧を読み直す)。 */
export const reportAiRowSavedResponseSchema = z.object({ id: idSchema, rowVersion, updatedAt: z.string() });

/** DELETE /api/admin/report-ai/:kind/:id(アーカイブ。取込で同じキーの行が来れば戻る)。 */
export const archiveReportAiRowRequestSchema = z.object({ rowVersion: rowVersion.optional() });

// ── 取込・書き出し ──

/** 取込むファイルの上限(バイト。base64 にする前)。 */
export const REPORT_AI_IMPORT_MAX_BYTES = 2 * 1024 * 1024;

/** POST /api/admin/report-ai/import。dryRun=true は検証と件数の確認だけ(何も書かない)。 */
export const reportAiImportRequestSchema = z.object({
  fileName: z.string().trim().max(200).optional(),
  /** xlsx の中身(base64。data URL の頭は付けない)。 */
  fileBase64: z
    .string()
    .min(1, 'ファイルを選んでください')
    .max(Math.ceil((REPORT_AI_IMPORT_MAX_BYTES * 4) / 3) + 4, 'ファイルが大きすぎます(2MBまで)'),
  dryRun: z.boolean().default(true),
});
export type ReportAiImportRequest = z.input<typeof reportAiImportRequestSchema>;

export const REPORT_AI_MASTER_KINDS = [
  'keywords',
  'ageBands',
  'educationLevels',
  'psiLevels',
  'phrases',
  'stanceRules',
] as const;
export type ReportAiMasterKind = (typeof REPORT_AI_MASTER_KINDS)[number];
export const REPORT_AI_MASTER_KIND_LABELS: Record<ReportAiMasterKind, string> = {
  keywords: 'キーワード',
  ageBands: '年齢帯',
  educationLevels: '教育思考★',
  psiLevels: 'PSI',
  phrases: '表現',
  stanceRules: '見ていた人スタンス',
};

const importCountSchema = z.object({
  /** ファイルにあった行。 */
  rows: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
});
export type ReportAiImportCount = z.infer<typeof importCountSchema>;

export const reportAiImportIssueSchema = z.object({
  sheet: z.string(),
  /** Excel の行番号(1始まり)。シート全体の問題は null。 */
  row: z.number().int().nullable(),
  message: z.string(),
});
export type ReportAiImportIssue = z.infer<typeof reportAiImportIssueSchema>;

export const reportAiImportResponseSchema = z.object({
  dryRun: z.boolean(),
  /** 反映したか(dryRun のとき・誤りがあるときは false)。 */
  applied: z.boolean(),
  counts: z.object(
    Object.fromEntries(REPORT_AI_MASTER_KINDS.map((k) => [k, importCountSchema])) as Record<
      ReportAiMasterKind,
      typeof importCountSchema
    >,
  ),
  /** 反映できない誤り(1件でもあれば反映しない)。 */
  errors: z.array(reportAiImportIssueSchema),
  /** 反映はできるが知らせること(読まなかったシート・同じキーの行など)。 */
  warnings: z.array(reportAiImportIssueSchema),
});
export type ReportAiImportResponse = z.infer<typeof reportAiImportResponseSchema>;

/** GET /api/admin/report-ai/usage.csv の期間(教育キーワードの候補・使用の回数。366日まで)。 */
export const reportAiUsageQuerySchema = z
  .object({ from: businessDateSchema, to: businessDateSchema })
  .refine((q) => q.from <= q.to, { message: '期間の開始日は終了日より前にしてください', path: ['from'] });
export type ReportAiUsageQuery = z.infer<typeof reportAiUsageQuerySchema>;
export const REPORT_AI_USAGE_MAX_RANGE_DAYS = 366;

// ── 家庭ごとの教育思考★(customer_report_profiles) ──

export const customerReportProfileViewSchema = z.object({
  customerId: idSchema,
  /** 家庭の教育思考★。未設定は null(日報では DEFAULT_EDUCATION_LEVEL を使う)。 */
  educationLevel: z.number().int().min(REPORT_LEVEL_MIN).max(REPORT_LEVEL_MAX).nullable(),
  /** 未設定は null。 */
  rowVersion: z.number().int().positive().nullable(),
  updatedAt: z.string().nullable(),
  updatedByName: z.string().nullable(),
});
export type CustomerReportProfileView = z.infer<typeof customerReportProfileViewSchema>;
export const customerReportProfileResponseSchema = z.object({ profile: customerReportProfileViewSchema });

/** PUT /api/customers/:id/report-profile(ログインしているスタッフなら誰でも)。 */
export const saveCustomerReportProfileRequestSchema = z.object({
  /** null は未設定に戻す(☆0。日報では DEFAULT_EDUCATION_LEVEL を使う)。 */
  educationLevel: level.nullable(),
  /** 画面が読んだ版(未設定の家庭は省略)。 */
  rowVersion: rowVersion.optional(),
});
export type SaveCustomerReportProfileRequest = z.infer<typeof saveCustomerReportProfileRequestSchema>;
