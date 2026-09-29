import { createHash } from 'node:crypto';
import { AI_PROMPT_KEYS, type AiPromptKey, findAiPromptDefinition } from '@katahimo/shared';
import {
  accidentTimeInfo,
  ageInMonths,
  assembleDailyReportPrompt,
  buildReportModelChain,
  dailyTimeInfo,
  enforceEscalationWarning,
  invalid,
  newId,
  notFound,
  type ReportAiErrorCode,
  type ResolvedUsedKeywords,
  renderAccidentReportPrompt,
  reportModelFamilyOf,
  resolveUsedKeywords,
  zonedBusinessDate,
} from '../domain';
import type {
  AccidentReportDraft,
  AccidentReportDraftError,
  DailyReportDraft,
  ReceiptOcrResult,
  ReportAiPort,
  ReportAiPortFactory,
} from '../ports/ai';
import type { AppLogPort } from '../ports/appLog';
import type { ReportAiGenerationInput } from '../ports/reportAi';
import type { SecretBoxPort } from '../ports/secretBox';
import type { TenantSettingsRecord } from '../ports/settings';
import type { TenantRepositories } from '../ports/unitOfWork';
import type { AiPromptDeps } from './aiPrompts';
import { resolveReportCareRecipient } from './reportCareRecipient';
import type { Actor, Clock } from './requestMeta';
import { currentTime } from './requestMeta';
import { readTenantSecret } from './settings';

export interface ReportAiDeps extends AiPromptDeps, Clock {
  /** テナントが独自の Gemini API キーを設定していない場合に使うフォールバック(.env の設定か Noop)。 */
  reportAi: ReportAiPort;
  secretBox: SecretBoxPort;
  reportAiFactory: ReportAiPortFactory;
  appLog: AppLogPort;
  /** 生成の記録に残すアプリの版(Cloud Run の K_REVISION など。無ければ null)。 */
  appVersion?: string | null;
}

export interface ReportAiCaller {
  tenantId: string;
  staffId: string;
  meta?: Actor['meta'];
}

/**
 * テナントの秘密値(tenant_secrets)に Gemini API キーがあればそれとテナントのモデル設定を使い、無ければ .env の
 * 設定(deps.reportAi、未設定なら Noop)にする。キーが開けない・設定を読めないときも .env の設定に戻す
 * (AI の下書き・読み取りは失敗しても結果の形で返す処理のため、ここで例外にしない)。
 */
async function resolveReportAiPort(deps: ReportAiDeps, tenantId: string): Promise<ReportAiPort> {
  let apiKey: string;
  let settings: TenantSettingsRecord;
  try {
    [apiKey, settings] = await Promise.all([
      readTenantSecret(deps, tenantId, 'gemini_api_key'),
      deps.uow.run(tenantId, (r) => r.settings.get()),
    ]);
  } catch (e) {
    await deps.appLog.write({
      tenantId,
      level: 'ERROR',
      action: 'ai.settings.read_failed',
      details: { error: e instanceof Error ? e.name : 'unknown' },
    });
    return deps.reportAi;
  }
  if (!apiKey) return deps.reportAi;
  return deps.reportAiFactory.create({
    apiKey,
    ...(settings.geminiReportModel ? { reportModel: settings.geminiReportModel } : {}),
    ...(settings.geminiOcrModel ? { ocrModel: settings.geminiOcrModel } : {}),
  });
}

function logAiError(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  action: string,
  error: string,
  extra: Record<string, unknown> = {},
) {
  return deps.appLog.write({
    tenantId: caller.tenantId,
    level: 'ERROR',
    action,
    actorStaffId: caller.staffId,
    details: { ...extra, error: error.slice(0, 300) },
    ...caller.meta,
  });
}

/** API エラーのとき試し直すモデルの順番(core/domain/reports/modelFallback.ts)。 */
async function reportModelChainOf(reportAi: ReportAiPort): Promise<string[]> {
  const available =
    reportAi.reportModel && reportAi.availableModels ? await reportAi.availableModels() : null;
  return buildReportModelChain(reportAi.reportModel, available);
}

/**
 * 保育日報の生成で試すモデルの順番(設定のモデル → Flash 系 → Flash-Lite 系)。画面はこの順に
 * generateDailyReportDraft の model を変えて呼び、いま試しているモデルを見せる。API キーが無ければ空。
 */
export async function listDailyReportModels(deps: ReportAiDeps, caller: ReportAiCaller): Promise<string[]> {
  return reportModelChainOf(await resolveReportAiPort(deps, caller.tenantId));
}

/** テナントの上書き(版つき)か既定の文面。 */
interface ResolvedPrompt {
  body: string;
  /** テナントの上書きの版(既定の文面なら null)。 */
  revision: number | null;
}

async function resolvePrompt(r: TenantRepositories, key: AiPromptKey): Promise<ResolvedPrompt> {
  const row = await r.aiPrompts.findByKey(key);
  if (row?.body) return { body: row.body, revision: row.revision };
  return { body: findAiPromptDefinition(key)?.defaultBody ?? '', revision: null };
}

export interface GenerateDailyReportDraftInput {
  text: string;
  start?: string | undefined;
  end?: string | undefined;
  customerId: string;
  /** 対象のお子様(null = 選ばない、省略 = 世帯の子が1人ならその子。resolveReportCareRecipient)。 */
  careRecipientId?: string | null | undefined;
  riskRating?: number | null | undefined;
  /** 月齢を数える日('YYYY-MM-DD')。省略時はテナントの今日。 */
  reportDate?: string | undefined;
  /**
   * 試すモデル(listDailyReportModels の順の1つ)。省略時は設定のモデル。設定のモデルか Flash / Flash-Lite 系の
   * 名前だけを受け付ける(それ以外は 400。値段の違うモデルを画面から選ばせない)。
   */
  model?: string | undefined;
}

export interface DailyReportGeneration {
  draft: DailyReportDraft;
  ai: {
    generationId: string | null;
    usedKeywords: ResolvedUsedKeywords['items'];
    candidateCount: number;
    escalationRequired: boolean;
    childAgeMonths: number | null;
    educationLevel: number;
    effectiveEducationLevel: number | null;
    /** この生成で使ったモデル(API キーが無ければ null)。 */
    model: string | null;
    /** API エラーで、別のモデルで試し直す意味があるか(成功・API キー未設定・キーの誤りは false)。 */
    retryable: boolean;
  };
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function errorCodeOf(draft: DailyReportDraft): ReportAiErrorCode | null {
  if (draft.warnings.includes('API Key Missing')) return 'api_key_missing';
  if (draft.warnings.includes('API Error')) return 'api_error';
  return null;
}

/**
 * 保育日報のメモ(口語)からAI下書きを生成する(GAS版 GeminiReport.js generateReportWithWarnings + 日報AIの3軸)。
 * 1. 1つ目のトランザクションで お客様・対象のお子様・家庭の★・マスター・プロンプト を読む(対象のお子様が
 *    そのお客様の世帯の子でなければ 400。他の家庭の子の月齢で書く取り違えは生成の前に止める)
 * 2. プロンプトを組み立て(core/domain/reports/promptAssembly.ts)、トランザクションの外で Gemini を呼ぶ
 * 3. 生成の記録(report_ai_generations)を別のトランザクションで書く。記録に失敗しても生成の結果は返す
 *    (ERROR `ai.daily_report.generation_log_failed`。記録の ID は null)
 * input.model で試すモデルを変えられる(API エラーのとき、画面が listDailyReportModels の順に呼び直す。1回の呼び出しで
 * 試すのは1つのモデルだけ)。失敗は ERROR `ai.daily_report.generate_failed`(モデル名つき)、切り替え先で書けたら
 * WARN `ai.daily_report.model_fallback_succeeded` を残す。
 * PSI 1 は AI の答えに関わらず warnings に「管理者へ連絡」を入れる。失敗しても例外にはせず、warnings/internal に
 * その旨を詰めた同じ形を返す(GAS版と同じ)。プロンプト・メモの本文は操作ログに書かない。
 */
export async function generateDailyReportDraft(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  input: GenerateDailyReportDraftInput,
): Promise<DailyReportGeneration> {
  const startedAt = currentTime(deps);
  const reportAi = await resolveReportAiPort(deps, caller.tenantId);
  const model = input.model ?? reportAi.reportModel;
  if (
    input.model !== undefined &&
    (reportAi.reportModel === null ||
      (input.model !== reportAi.reportModel && reportModelFamilyOf(input.model) === null))
  ) {
    throw invalid('このモデルは使えません', { model: '使えないモデルです' }, 'model_not_allowed');
  }
  const context = await deps.uow.run(caller.tenantId, async (r) => {
    const customer = await r.customers.findById(input.customerId);
    if (!customer) throw notFound('お客様が見つかりません', 'customer_not_found');
    const recipient = await resolveReportCareRecipient(r, input.customerId, input.careRecipientId);
    const [profile, masters, template, companyPolicy, tenant] = await Promise.all([
      r.customerReportProfiles.find(input.customerId),
      r.reportAi.loadActive(),
      resolvePrompt(r, AI_PROMPT_KEYS.DAILY_REPORT_GENERATE),
      resolvePrompt(r, AI_PROMPT_KEYS.DAILY_REPORT_COMPANY_POLICY),
      r.tenant(),
    ]);
    return { recipient, profile, masters, template, companyPolicy, timeZone: tenant.timezone };
  });

  const onDate = input.reportDate ?? zonedBusinessDate(startedAt, context.timeZone);
  const birthDate = context.recipient?.birthDate ?? null;
  const childAgeMonths = birthDate ? ageInMonths(birthDate, onDate) : null;
  const timeInfo = dailyTimeInfo(input.start, input.end);
  const riskRating = input.riskRating ?? null;
  const assembled = assembleDailyReportPrompt({
    template: context.template.body,
    companyPolicy: context.companyPolicy.body,
    anonymizedText: input.text,
    timeInfo,
    childAgeMonths,
    educationLevel: context.profile?.educationLevel ?? null,
    riskRating,
    masters: context.masters,
  });

  const raw = await reportAi.generateDailyReport({
    prompt: assembled.prompt,
    ...(input.model !== undefined ? { model: input.model } : {}),
  });
  const errorCode = errorCodeOf(raw);
  const fallback = model !== null && model !== reportAi.reportModel;
  if (errorCode) {
    await logAiError(deps, caller, 'ai.daily_report.generate_failed', raw.internal, {
      customerId: input.customerId,
      model,
      fallback,
      retryable: raw.retryable === true,
    });
  } else if (fallback) {
    // 設定のモデルが使えず、切り替えた先のモデルで書けた(どのモデルで書いたかを残す)
    await deps.appLog.write({
      tenantId: caller.tenantId,
      level: 'WARN',
      action: 'ai.daily_report.model_fallback_succeeded',
      actorStaffId: caller.staffId,
      details: { customerId: input.customerId, model, configuredModel: reportAi.reportModel },
      ...caller.meta,
    });
  }
  const used = resolveUsedKeywords(
    errorCode ? [] : raw.usedKeywords,
    assembled.candidates,
    context.masters.keywords,
  );
  const { adjustment } = assembled;
  const warnings =
    !errorCode && adjustment.escalationRequired ? enforceEscalationWarning(raw.warnings) : raw.warnings;
  const draft: DailyReportDraft = { warnings, internal: raw.internal, customer: raw.customer };

  const generationId = newId();
  const recorded = await recordGeneration(deps, caller, {
    id: generationId,
    staffId: caller.staffId,
    customerId: input.customerId,
    careRecipientId: context.recipient?.id ?? null,
    promptKey: AI_PROMPT_KEYS.DAILY_REPORT_GENERATE,
    promptRevision: context.template.revision,
    defaultPromptSha256: context.template.revision === null ? sha256(context.template.body) : null,
    appVersion: deps.appVersion ?? null,
    model,
    promptText: assembled.prompt,
    inputText: input.text,
    timeInfo,
    startedAt,
    finishedAt: currentTime(deps),
    childAgeMonths,
    educationLevel: adjustment.educationLevel,
    effectiveEducationLevel: adjustment.effectiveEducationLevel,
    riskRating,
    escalationRequired: adjustment.escalationRequired,
    candidateKeywordIds: assembled.candidates.map((k) => k.id),
    usedKeywordIds: used.keywordIds,
    unresolvedUsedCodes: used.unresolved,
    output: errorCode ? null : { ...raw, warnings },
    errorCode,
  });

  return {
    draft,
    ai: {
      generationId: recorded ? generationId : null,
      usedKeywords: used.items,
      candidateCount: assembled.candidates.length,
      escalationRequired: adjustment.escalationRequired,
      childAgeMonths,
      educationLevel: adjustment.educationLevel,
      effectiveEducationLevel: adjustment.effectiveEducationLevel,
      model,
      retryable: errorCode === 'api_error' && raw.retryable === true,
    },
  };
}

/** 生成の記録を書く(失敗しても生成の結果は壊さない。false を返して ERROR を残す)。 */
async function recordGeneration(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  input: ReportAiGenerationInput,
): Promise<boolean> {
  try {
    await deps.uow.run(caller.tenantId, (r) => r.reportAiGenerations.insert(input), {
      actorId: caller.staffId,
    });
    return true;
  } catch (e) {
    await deps.appLog.write({
      tenantId: caller.tenantId,
      level: 'ERROR',
      action: 'ai.daily_report.generation_log_failed',
      actorStaffId: caller.staffId,
      details: { customerId: input.customerId, error: e instanceof Error ? e.name : 'unknown' },
      ...caller.meta,
    });
    return false;
  }
}

/** GAS版GeminiReport.js generateAccidentReportに対応。失敗時は{error}を返す。 */
export async function generateAccidentReportDraft(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  input: { text: string; start?: string | undefined; end?: string | undefined },
): Promise<AccidentReportDraft | AccidentReportDraftError> {
  const [reportAi, template] = await Promise.all([
    resolveReportAiPort(deps, caller.tenantId),
    deps.uow.run(caller.tenantId, (r) => resolvePrompt(r, AI_PROMPT_KEYS.ACCIDENT_REPORT_GENERATE)),
  ]);
  const prompt = renderAccidentReportPrompt(
    template.body,
    input.text,
    accidentTimeInfo(input.start, input.end),
  );
  const draft = await reportAi.generateAccidentReport({ prompt });
  if ('error' in draft) await logAiError(deps, caller, 'ai.accident_report.generate_failed', draft.error);
  return draft;
}

/** GAS版GeminiReport.js extractAmountFromImageに対応。失敗時も空値のフォールバックを返す。 */
export async function extractReceiptAmount(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  base64Image: string,
): Promise<ReceiptOcrResult> {
  const reportAi = await resolveReportAiPort(deps, caller.tenantId);
  const result = await reportAi.extractReceiptAmount(base64Image);
  if (result.error) await logAiError(deps, caller, 'ai.receipt_ocr.failed', result.error);
  return result;
}
