import type { ReportPhraseKind, TermNamePolicy } from '@katahimo/shared';

/**
 * 日報AIの調整のマスター(お客様の「日報キーワード表現マスター」のシート01〜06)の1行。DB の行
 * (report_keywords 等)と同じ形で、アーカイブしていない行だけを渡す。空の文字列の欄は null。
 */

/** シート01 マスター表の1行(教育キーワード)。 */
export interface ReportKeywordEntry {
  id: string;
  code: string;
  category: string | null;
  keyword: string;
  subConcept: string | null;
  ageLabel: string | null;
  /** 年齢下限(月齢。含む)。 */
  ageFromMonths: number;
  /** 年齢上限(月齢。含む。シート00「対象月齢 ∈ [列F, 列G]」)。 */
  ageToMonths: number;
  ageBandLabel: string | null;
  educationLevelMin: number;
  educationLevelMax: number;
  /** PSI下限(この値以上で使用可)。 */
  psiMin: number;
  tone: string | null;
  parentExplanation: string | null;
  phraseExamples: string | null;
  usageScene: string | null;
  ngExample: string | null;
  sortOrder: number;
}

/** シート02 年齢帯定義の1行。月齢範囲は半開区間 [from, to)(「0〜6ヶ月」「6〜12ヶ月」の6ヶ月は後の帯)。 */
export interface ReportAgeBandEntry {
  id: string;
  label: string;
  ageFromMonths: number;
  ageToMonths: number;
  behaviorWords: string | null;
  developmentTopics: string | null;
  /** 相性の良いキーワードID(この順に候補の先頭に寄せる)。 */
  keywordCodes: string[];
  sceneExamples: string | null;
  sortOrder: number;
}

/** シート03 教育思考レベル定義の1行(★1〜5)。 */
export interface ReportEducationLevelEntry {
  level: number;
  label: string | null;
  customerProfile: string | null;
  usage: string | null;
  wordScope: string | null;
  termNameRule: string | null;
  termNamePolicy: TermNamePolicy;
  keywordsMin: number;
  keywordsMax: number;
  toneFocus: string | null;
  exampleDirection: string | null;
}

/** シート04 PSI指標定義の1行(5〜1)。 */
export interface ReportPsiLevelEntry {
  level: number;
  label: string;
  criteria: string | null;
}

/** シート05 温かみ表現・PSI配慮の1行。 */
export interface ReportPhraseEntry {
  id: string;
  kind: ReportPhraseKind;
  body: string;
  message: string | null;
  /** 推奨PSIの範囲(両端を含む。避ける表現は 1〜5)。 */
  psiMin: number;
  psiMax: number;
  note: string | null;
  sortOrder: number;
}

/** シート06 見ていた人スタンス・NG表現の1行。 */
export interface ReportStanceRuleEntry {
  id: string;
  topic: string;
  avoidText: string | null;
  recommendedText: string | null;
  reason: string | null;
  sortOrder: number;
}

/** テナントのマスター一式(アーカイブしていない行)。 */
export interface ReportAiMasters {
  keywords: ReportKeywordEntry[];
  ageBands: ReportAgeBandEntry[];
  educationLevels: ReportEducationLevelEntry[];
  psiLevels: ReportPsiLevelEntry[];
  phrases: ReportPhraseEntry[];
  stanceRules: ReportStanceRuleEntry[];
}

export const EMPTY_REPORT_AI_MASTERS: ReportAiMasters = {
  keywords: [],
  ageBands: [],
  educationLevels: [],
  psiLevels: [],
  phrases: [],
  stanceRules: [],
};

/**
 * ★の定義(シート03)が無いテナントで使う、★ごとの教育語の数と用語名の扱い。シート03 の「1通あたり教育語」
 * 「用語名の扱い」の値(★1: 0個・用語名NG / ★2: 0〜1個・出さない / ★3: 1個・控えめ / ★4・★5: 1〜2個・説明とセット)。
 * 文言(呼称・使い方)はテナントのマスターにしかない。
 */
export const DEFAULT_EDUCATION_LEVEL_RULES: Readonly<
  Record<number, Pick<ReportEducationLevelEntry, 'keywordsMin' | 'keywordsMax' | 'termNamePolicy'>>
> = {
  1: { keywordsMin: 0, keywordsMax: 0, termNamePolicy: 'forbid' },
  2: { keywordsMin: 0, keywordsMax: 1, termNamePolicy: 'forbid' },
  3: { keywordsMin: 1, keywordsMax: 1, termNamePolicy: 'sparing' },
  4: { keywordsMin: 1, keywordsMax: 2, termNamePolicy: 'allow' },
  5: { keywordsMin: 1, keywordsMax: 2, termNamePolicy: 'allow' },
};
