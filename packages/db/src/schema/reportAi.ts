import {
  REPORT_AI_ERROR_CODES,
  REPORT_PHRASE_KINDS,
  type ReportPhraseKind,
  TERM_NAME_POLICIES,
  type TermNamePolicy,
} from '@katahimo/core/domain';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, oneOf, rowVersion, tenantIdColumn, updatedAt } from './_columns';
import { tenantFk, tenantIsolation, tenantRef, tenantScoped } from './_helpers';
import { careRecipients, customers } from './customers';
import { careRecords } from './records';
import { staff } from './staff';

/**
 * 日報AIの調整(年齢帯 × 教育思考★ × PSI)。お客様の「日報キーワード表現マスター」(xlsx)のシート01〜06を
 * テナントごとに持つ。管理画面「日報AIの調整」で行ごとに編集(row_version)・xlsx の取込(自然キーで突き合わせて
 * マージ)・書き出しをする。行は消さずに archived_at でプロンプトから外す(同じキーで足す・取り込むと戻る)。
 * プロンプトの組み立ては core/domain/reports/promptAssembly.ts。
 */

const levelCheck = (name: string, column: AnyPgColumn) => check(name, sql`${column} between 1 and 5`);

/** シート01 マスター表(教育キーワード)。対象月齢は両端を含む [age_from_months, age_to_months]。 */
export const reportKeywords = pgTable(
  'report_keywords',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** ID(K01 など。大文字)。取込で突き合わせるキー。 */
    code: text().notNull(),
    category: text(),
    keyword: text().notNull(),
    subConcept: text(),
    /** 対象年齢(表示)。 */
    ageLabel: text(),
    ageFromMonths: smallint().notNull(),
    ageToMonths: smallint().notNull(),
    /** 適用年齢帯(表示)。 */
    ageBandLabel: text(),
    educationLevelMin: smallint().notNull(),
    educationLevelMax: smallint().notNull(),
    /** PSI下限(この値以上で使用可)。 */
    psiMin: smallint().notNull(),
    tone: text(),
    /** 親向け説明(やさしい言い換え)。 */
    parentExplanation: text(),
    /** 日報フレーズ例(見ていた人スタンス)。改行区切り。 */
    phraseExamples: text(),
    usageScene: text(),
    ngExample: text(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    updatedBy: uuid(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('report_keywords', t),
    tenantRef('report_keywords', 'updated_by', t, t.updatedBy, staff),
    unique('report_keywords_tenant_id_code_key').on(t.tenantId, t.code),
    check(
      'report_keywords_age_check',
      sql`${t.ageFromMonths} >= 0 and ${t.ageToMonths} <= 144 and ${t.ageFromMonths} <= ${t.ageToMonths}`,
    ),
    check(
      'report_keywords_education_level_check',
      sql`${t.educationLevelMin} between 1 and 5 and ${t.educationLevelMax} between 1 and 5 and ${t.educationLevelMin} <= ${t.educationLevelMax}`,
    ),
    levelCheck('report_keywords_psi_min_check', t.psiMin),
    check('report_keywords_code_check', sql`${t.code} ~ '^[A-Z0-9_-]{1,20}$'`),
  ],
).enableRLS();

/**
 * シート02 年齢帯定義。月齢範囲は半開区間 [age_from_months, age_to_months)(「0〜6ヶ月」と「6〜12ヶ月」の6ヶ月は
 * 後の帯)。アーカイブしていない帯どうしの範囲の重なりは EXCLUDE 制約(0001_baseline_custom.sql。取込は1つの
 * トランザクションで帯を入れ替えるため、確かめるのはコミットのとき)。
 */
export const reportAgeBands = pgTable(
  'report_age_bands',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** 年齢帯(「0-6ヶ月」「1歳」など)。取込で突き合わせるキー。 */
    label: text().notNull(),
    ageFromMonths: smallint().notNull(),
    ageToMonths: smallint().notNull(),
    /** この時期によく描写する行動・単語。 */
    behaviorWords: text(),
    developmentTopics: text(),
    /** 相性の良いキーワードID(この順に候補の先頭へ)。 */
    keywordCodes: text().array().notNull().default(sql`'{}'::text[]`),
    sceneExamples: text(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    updatedBy: uuid(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('report_age_bands', t),
    tenantRef('report_age_bands', 'updated_by', t, t.updatedBy, staff),
    unique('report_age_bands_tenant_id_label_key').on(t.tenantId, t.label),
    check(
      'report_age_bands_age_check',
      sql`${t.ageFromMonths} >= 0 and ${t.ageToMonths} <= 144 and ${t.ageFromMonths} < ${t.ageToMonths}`,
    ),
  ],
).enableRLS();

/** シート03 教育思考レベル定義(★1〜5 の各1行)。 */
export const reportEducationLevels = pgTable(
  'report_education_levels',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    level: smallint().notNull(),
    /** 呼称。 */
    label: text(),
    customerProfile: text(),
    /** 教育語の使い方。 */
    usage: text(),
    wordScope: text(),
    /** 用語名の扱い(表の文言)。 */
    termNameRule: text(),
    termNamePolicy: text({ enum: TERM_NAME_POLICIES }).$type<TermNamePolicy>().notNull(),
    /** 1通あたり教育語の下限・上限。 */
    keywordsMin: smallint().notNull(),
    keywordsMax: smallint().notNull(),
    toneFocus: text(),
    exampleDirection: text(),
    updatedBy: uuid(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('report_education_levels', t),
    tenantRef('report_education_levels', 'updated_by', t, t.updatedBy, staff),
    unique('report_education_levels_tenant_id_level_key').on(t.tenantId, t.level),
    levelCheck('report_education_levels_level_check', t.level),
    check('report_education_levels_term_name_policy_check', oneOf(t.termNamePolicy, TERM_NAME_POLICIES)),
    check(
      'report_education_levels_keywords_check',
      sql`${t.keywordsMin} >= 0 and ${t.keywordsMin} <= ${t.keywordsMax} and ${t.keywordsMax} <= 9`,
    ),
  ],
).enableRLS();

/** シート04 PSI指標定義(5〜1 の各1行)。日報の画面の PSI の定義・判定基準にも使う。 */
export const reportPsiLevels = pgTable(
  'report_psi_levels',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    level: smallint().notNull(),
    /** 定義(「安心・良好」など)。 */
    label: text().notNull(),
    criteria: text(),
    updatedBy: uuid(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('report_psi_levels', t),
    tenantRef('report_psi_levels', 'updated_by', t, t.updatedBy, staff),
    unique('report_psi_levels_tenant_id_level_key').on(t.tenantId, t.level),
    levelCheck('report_psi_levels_level_check', t.level),
  ],
).enableRLS();

/**
 * シート05 温かみ表現・PSI配慮。warm(◎使う)は推奨PSIの範囲 [psi_min, psi_max] の日報で、avoid(✕避ける)は
 * PSI に関わらず全ての日報で使わない(範囲は常に 1〜5)。
 */
export const reportPhrases = pgTable(
  'report_phrases',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    kind: text({ enum: REPORT_PHRASE_KINDS }).$type<ReportPhraseKind>().notNull(),
    /** 表現例/避ける言い回し。区分と合わせて取込で突き合わせるキー。 */
    body: text().notNull(),
    /** 込めるメッセージ/理由。 */
    message: text(),
    psiMin: smallint().notNull(),
    psiMax: smallint().notNull(),
    note: text(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    updatedBy: uuid(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('report_phrases', t),
    tenantRef('report_phrases', 'updated_by', t, t.updatedBy, staff),
    unique('report_phrases_tenant_id_kind_body_key').on(t.tenantId, t.kind, t.body),
    check('report_phrases_kind_check', oneOf(t.kind, REPORT_PHRASE_KINDS)),
    check(
      'report_phrases_psi_check',
      sql`${t.psiMin} between 1 and 5 and ${t.psiMax} between 1 and 5 and ${t.psiMin} <= ${t.psiMax} and (${t.kind} = 'warm' or (${t.psiMin} = 1 and ${t.psiMax} = 5))`,
    ),
  ],
).enableRLS();

/** シート06 見ていた人スタンス・NG表現(✕避ける → ◎推奨)。 */
export const reportStanceRules = pgTable(
  'report_stance_rules',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    /** 項目(「評価口調」など)。取込で突き合わせるキー。 */
    topic: text().notNull(),
    avoidText: text(),
    recommendedText: text(),
    reason: text(),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    updatedBy: uuid(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    ...tenantScoped('report_stance_rules', t),
    tenantRef('report_stance_rules', 'updated_by', t, t.updatedBy, staff),
    unique('report_stance_rules_tenant_id_topic_key').on(t.tenantId, t.topic),
  ],
).enableRLS();

/**
 * 家庭ごとの教育思考★(1〜5)。customers(顧客の取込が書き換える)とは別の表にして、取込で消えないようにする。
 * 行が無い家庭は★2(DEFAULT_EDUCATION_LEVEL)。ログインしているスタッフなら誰でも変えられる。
 */
export const customerReportProfiles = pgTable(
  'customer_report_profiles',
  {
    tenantId: tenantIdColumn(),
    customerId: uuid().notNull(),
    educationLevel: smallint().notNull(),
    updatedBy: uuid(),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'customer_report_profiles_pkey', columns: [t.tenantId, t.customerId] }),
    tenantFk('customer_report_profiles', t),
    tenantIsolation(),
    tenantRef('customer_report_profiles', 'customer_id', t, t.customerId, customers, 'cascade'),
    tenantRef('customer_report_profiles', 'updated_by', t, t.updatedBy, staff),
    levelCheck('customer_report_profiles_education_level_check', t.educationLevel),
  ],
).enableRLS();

/**
 * 保育日報の AI 生成1回の記録(追記のみ。アプリロールは SELECT / INSERT と care_record_id の UPDATE だけ)。
 * 送ったプロンプトの全文・入力メモ・AI の答え(個人情報を含む)を持つため、操作ログには書かない。
 * 日報を保存すると care_record_id を書く(上書き保存でも前の生成は結び付いたまま)。保存されなかった生成は
 * 365日、結び付いた生成は日報の保存期限(care_records.retain_until)を過ぎたら保守ジョブが消す。
 * 候補・使った語はキーワードの ID の配列(アーカイブした語も ID は残る)。
 */
export const reportAiGenerations = pgTable(
  'report_ai_generations',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    staffId: uuid().notNull(),
    customerId: uuid().notNull(),
    careRecipientId: uuid(),
    careRecordId: uuid(),
    /** AIプロンプトのキー(daily_report.generate)。 */
    promptKey: text().notNull(),
    /** テナントが上書きしたプロンプトの版(既定の文面なら null)。 */
    promptRevision: integer(),
    /** 既定の文面を使ったとき、その文面の SHA-256(16進)。 */
    defaultPromptSha256: text(),
    /** アプリの版(Cloud Run のリビジョン)。 */
    appVersion: text(),
    model: text(),
    promptText: text().notNull(),
    inputText: text().notNull(),
    timeInfo: text().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull(),
    finishedAt: timestamp({ withTimezone: true }).notNull(),
    childAgeMonths: smallint(),
    /** 家庭の教育思考★(未設定は既定の★2)。 */
    educationLevel: smallint().notNull(),
    /** PSI で調整したあとの★(PSI 2 以下は教育語を使わないので null)。 */
    effectiveEducationLevel: smallint(),
    riskRating: smallint(),
    escalationRequired: boolean().notNull(),
    candidateKeywordIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    usedKeywordIds: uuid().array().notNull().default(sql`'{}'::uuid[]`),
    /** AI が使ったと答えたが表に無かった語(そのままの文字列)。 */
    unresolvedUsedCodes: text().array().notNull().default(sql`'{}'::text[]`),
    output: jsonb().$type<Record<string, unknown>>(),
    errorCode: text({ enum: REPORT_AI_ERROR_CODES }),
    createdAt: createdAt(),
  },
  (t) => [
    ...tenantScoped('report_ai_generations', t),
    tenantRef('report_ai_generations', 'staff_id', t, t.staffId, staff),
    tenantRef('report_ai_generations', 'customer_id', t, t.customerId, customers),
    tenantRef('report_ai_generations', 'care_recipient_id', t, t.careRecipientId, careRecipients),
    tenantRef('report_ai_generations', 'care_record_id', t, t.careRecordId, careRecords),
    index('report_ai_generations_tenant_id_created_at_idx').on(t.tenantId, t.createdAt),
    index('report_ai_generations_tenant_id_care_record_id_idx').on(t.tenantId, t.careRecordId),
    check('report_ai_generations_error_code_check', oneOf(t.errorCode, REPORT_AI_ERROR_CODES)),
    check('report_ai_generations_outcome_check', sql`(${t.output} is null) <> (${t.errorCode} is null)`),
    check(
      'report_ai_generations_prompt_check',
      sql`(${t.promptRevision} is null) = (${t.defaultPromptSha256} is not null)`,
    ),
    check(
      'report_ai_generations_levels_check',
      sql`${t.educationLevel} between 1 and 5 and ${t.effectiveEducationLevel} between 1 and 5 and ${t.riskRating} between 1 and 5`,
    ),
    check('report_ai_generations_child_age_months_check', sql`${t.childAgeMonths} >= 0`),
    check('report_ai_generations_finished_at_check', sql`${t.finishedAt} >= ${t.startedAt}`),
  ],
).enableRLS();
