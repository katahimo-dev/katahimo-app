import type {
  ReportAgeBandInput,
  ReportEducationLevelInput,
  ReportKeywordInput,
  ReportPhraseInput,
  ReportPsiLevelInput,
  ReportStanceRuleInput,
} from '@katahimo/shared';
import type { ReportAiMasters } from '../domain/reports/reportAiMasters';

/**
 * 日報AIの調整のマスター(report_keywords / report_age_bands / report_education_levels / report_psi_levels /
 * report_phrases / report_stance_rules)・家庭ごとの教育思考★(customer_report_profiles)・AI 生成の記録
 * (report_ai_generations)のリポジトリ。
 */

/** 行の版と更新の情報(管理画面の一覧)。 */
export interface ReportAiRowMeta {
  id: string;
  rowVersion: number;
  updatedAt: Date;
}

export type ReportKeywordRecord = ReportKeywordInput & ReportAiRowMeta;
export type ReportAgeBandRecord = ReportAgeBandInput & ReportAiRowMeta;
export type ReportEducationLevelRecord = ReportEducationLevelInput & ReportAiRowMeta;
export type ReportPsiLevelRecord = ReportPsiLevelInput & ReportAiRowMeta;
export type ReportPhraseRecord = ReportPhraseInput & ReportAiRowMeta;
export type ReportStanceRuleRecord = ReportStanceRuleInput & ReportAiRowMeta;

/** アーカイブしていない行の一式(管理画面・取込の突き合わせ・書き出し)。 */
export interface ReportAiMasterRecords {
  keywords: ReportKeywordRecord[];
  ageBands: ReportAgeBandRecord[];
  educationLevels: ReportEducationLevelRecord[];
  psiLevels: ReportPsiLevelRecord[];
  phrases: ReportPhraseRecord[];
  stanceRules: ReportStanceRuleRecord[];
}

/** 行ごとの編集の対象(追加・更新・アーカイブできる表)。 */
export interface ReportAiRowTypes {
  keywords: ReportKeywordInput;
  ageBands: ReportAgeBandInput;
  phrases: ReportPhraseInput;
  stanceRules: ReportStanceRuleInput;
}
export type ReportAiRowTable = keyof ReportAiRowTypes;

/** 段階(1〜5)ごとに1行の表。 */
export interface ReportAiLevelTypes {
  educationLevels: ReportEducationLevelInput;
  psiLevels: ReportPsiLevelInput;
}
export type ReportAiLevelTable = keyof ReportAiLevelTypes;

export interface ReportAiMasterRepository {
  /** アーカイブしていない行の一式(生成のプロンプトの組み立て)。 */
  loadActive(): Promise<ReportAiMasters>;
  /** アーカイブしていない行を版つきで(管理画面)。 */
  listRecords(): Promise<ReportAiMasterRecords>;
  /**
   * 自然キー(キーワードID・年齢帯・区分+本文・項目)でアーカイブしたものも含めて探す(取込の突き合わせ)。
   * 見つかった行の ID・版・アーカイブされているか。
   */
  findRowByKey<T extends ReportAiRowTable>(
    table: T,
    key: string,
  ): Promise<{ id: string; rowVersion: number; archived: boolean; value: ReportAiRowTypes[T] } | null>;
  /** 行を足す(自然キーが重なれば conflict)。 */
  insertRow<T extends ReportAiRowTable>(
    table: T,
    id: string,
    value: ReportAiRowTypes[T],
    updatedBy: string,
  ): Promise<ReportAiRowMeta>;
  /**
   * 行を書き換える(アーカイブされていれば戻す)。expectedVersion を渡すと版が一致するときだけ(違えば conflict)。
   * 行が無ければ not_found。
   */
  updateRow<T extends ReportAiRowTable>(
    table: T,
    id: string,
    value: ReportAiRowTypes[T],
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<ReportAiRowMeta>;
  /** 行をアーカイブする(版が違えば conflict、無ければ not_found)。 */
  archiveRow(table: ReportAiRowTable, id: string, updatedBy: string, expectedVersion?: number): Promise<void>;
  /** 段階の行を書く(無ければ作る)。expectedVersion は既にある行の版(違えば conflict)。 */
  upsertLevel<T extends ReportAiLevelTable>(
    table: T,
    id: string,
    value: ReportAiLevelTypes[T],
    updatedBy: string,
    expectedVersion?: number,
  ): Promise<ReportAiRowMeta>;
}

/** 家庭ごとの教育思考★。 */
export interface CustomerReportProfileRecord {
  customerId: string;
  educationLevel: number;
  rowVersion: number;
  updatedAt: Date;
  updatedBy: string | null;
}

export interface CustomerReportProfileRepository {
  find(customerId: string): Promise<CustomerReportProfileRecord | null>;
  /**
   * 書く(無ければ作る)。expectedVersion を渡すと既にある行の版が一致するときだけ(違えば conflict。無い行に版を
   * 渡したとき・版を渡さずに既にある行へ書いたときも、他の人が先に保存したので conflict)。
   */
  save(
    customerId: string,
    educationLevel: number,
    updatedBy: string,
    expectedVersion: number | undefined,
  ): Promise<CustomerReportProfileRecord>;
}

/** AI 生成1回の記録(追記のみ。アプリが後から変えるのは日報への結び付け care_record_id だけ)。 */
export interface ReportAiGenerationInput {
  id: string;
  staffId: string;
  customerId: string;
  careRecipientId: string | null;
  promptKey: string;
  /** テナントが上書きしたプロンプトの版(既定の文面なら null)。 */
  promptRevision: number | null;
  /** 既定の文面を使ったときの、その文面の SHA-256(16進)。 */
  defaultPromptSha256: string | null;
  appVersion: string | null;
  model: string | null;
  promptText: string;
  inputText: string;
  timeInfo: string;
  startedAt: Date;
  finishedAt: Date;
  childAgeMonths: number | null;
  educationLevel: number;
  effectiveEducationLevel: number | null;
  riskRating: number | null;
  escalationRequired: boolean;
  candidateKeywordIds: string[];
  usedKeywordIds: string[];
  unresolvedUsedCodes: string[];
  /** AI の答え(成功)か、失敗の種類(REPORT_AI_ERROR_CODES)のどちらか一方。 */
  output: Record<string, unknown> | null;
  errorCode: string | null;
}

export interface ReportAiGenerationRecord {
  id: string;
  staffId: string;
  customerId: string;
  careRecipientId: string | null;
  careRecordId: string | null;
  promptKey: string;
  promptRevision: number | null;
  model: string | null;
  riskRating: number | null;
  errorCode: string | null;
  createdAt: Date;
}

/** キーワードごとの候補・使用の回数(利用状況の CSV)。 */
export interface ReportKeywordUsageRow {
  keywordId: string;
  candidateCount: number;
  usedCount: number;
}

export interface ReportAiGenerationRepository {
  insert(input: ReportAiGenerationInput): Promise<void>;
  findById(id: string): Promise<ReportAiGenerationRecord | null>;
  /** 日報に結び付ける(care_record_id だけを書く)。 */
  linkToCareRecord(id: string, careRecordId: string): Promise<void>;
  /** [from, to) に作った生成の、キーワードごとの候補・使用の回数。 */
  keywordUsage(from: Date, to: Date): Promise<ReportKeywordUsageRow[]>;
}
