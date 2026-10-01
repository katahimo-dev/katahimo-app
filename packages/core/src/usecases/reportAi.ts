import { createHash } from 'node:crypto';
import { AI_PROMPT_KEYS, type AiPromptKey, findAiPromptDefinition } from '@katahimo/shared';
import {
  type AssembledDailyReportPrompt,
  accidentTimeInfo,
  ageInMonths,
  assembleDailyReportPrompt,
  buildOcrModelChain,
  buildReportModelChain,
  dailyTimeInfo,
  enforceEscalationWarning,
  invalid,
  newId,
  notFound,
  type ReportAiErrorCode,
  type ReportAiMasters,
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
import type { CareRecipientRecord } from '../ports/customers';
import type { CustomerReportProfileRecord, ReportAiGenerationInput } from '../ports/reportAi';
import type { SecretBoxPort } from '../ports/secretBox';
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
 * テナントの秘密値(tenant_secrets)に Gemini API キーがあればそのキーを使い、無ければ .env の設定(deps.reportAi、
 * 未設定なら Noop)にする。キーが開けないときも .env の設定に戻す(AI の下書き・読み取りは失敗しても結果の形で
 * 返す処理のため、ここで例外にしない)。モデルは自動で選ぶ(core/domain/reports/modelFallback.ts)。
 */
export async function resolveReportAiPort(
  deps: Pick<ReportAiDeps, 'uow' | 'secretBox' | 'appLog' | 'reportAi' | 'reportAiFactory'>,
  tenantId: string,
): Promise<ReportAiPort> {
  let apiKey: string;
  try {
    apiKey = await readTenantSecret(deps, tenantId, 'gemini_api_key');
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
  return deps.reportAiFactory.create({ apiKey });
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

/** 使えるモデルの一覧(API キーが無ければ読まない。読めなければ null = 既知の名前)。 */
async function availableModelsOf(reportAi: ReportAiPort): Promise<string[] | null> {
  return reportAi.hasApiKey && reportAi.availableModels ? await reportAi.availableModels() : null;
}

/** 日報・事故報告で試すモデルの順番(core/domain/reports/modelFallback.ts)。API キーが無ければ空。 */
async function reportModelChainOf(reportAi: ReportAiPort): Promise<string[]> {
  if (!reportAi.hasApiKey) return [];
  return buildReportModelChain(await availableModelsOf(reportAi));
}

/**
 * 保育日報・事故報告の生成で試すモデルの順番(Flash 系 → Flash-Lite 系。系統の中は -latest が先頭)。画面はこの順に
 * generateDailyReportDraft / generateAccidentReportDraft の model を変えて呼び、いま試しているモデルを見せる。
 * API キーが無ければ空。
 */
export async function listReportModels(deps: ReportAiDeps, caller: ReportAiCaller): Promise<string[]> {
  return reportModelChainOf(await resolveReportAiPort(deps, caller.tenantId));
}

/** 試すモデル。画面の指定(Flash / Flash-Lite 系だけ。それ以外・API キーが無いのに指定は 400)か、順番の先頭。 */
interface ChosenModel {
  /** 使うモデル(API キーが無ければ null)。 */
  model: string | null;
  /** 順番の先頭(先頭でないモデルで書けたら「切り替えた」として残す)。 */
  firstModel: string | null;
}

async function chooseReportModel(
  reportAi: ReportAiPort,
  requested: string | undefined,
): Promise<ChosenModel> {
  if (requested !== undefined && (!reportAi.hasApiKey || reportModelFamilyOf(requested) === null)) {
    throw invalid('このモデルは使えません', { model: '使えないモデルです' }, 'model_not_allowed');
  }
  const chain = await reportModelChainOf(reportAi);
  const firstModel = chain[0] ?? null;
  return { model: requested ?? firstModel, firstModel };
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
   * 試すモデル(listReportModels の順の1つ)。省略時はその先頭。Flash / Flash-Lite 系の名前だけを受け付ける
   * (それ以外は 400。値段の違うモデルを画面から選ばせない)。
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

/** 下書きの失敗の種類(成功は null)。生成と運用のモデル比較(reportAiCompare.ts)で同じ判定。 */
export function dailyReportErrorCodeOf(draft: DailyReportDraft): ReportAiErrorCode | null {
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
 * input.model で試すモデルを変えられる(API エラーのとき、画面が listReportModels の順に呼び直す。1回の呼び出しで
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
  const { model, firstModel } = await chooseReportModel(reportAi, input.model);
  const context = await deps.uow.run(caller.tenantId, (r) =>
    loadDailyReportPromptContext(r, input.customerId, input.careRecipientId),
  );

  const onDate = input.reportDate ?? zonedBusinessDate(startedAt, context.timeZone);
  const timeInfo = dailyTimeInfo(input.start, input.end);
  const riskRating = input.riskRating ?? null;
  const { assembled, childAgeMonths } = buildDailyReportPrompt(context, {
    text: input.text,
    timeInfo,
    onDate,
    riskRating,
  });

  const raw = await reportAi.generateDailyReport({
    prompt: assembled.prompt,
    ...(model !== null ? { model } : {}),
  });
  const errorCode = dailyReportErrorCodeOf(raw);
  const fallback = model !== null && model !== firstModel;
  if (errorCode) {
    await logAiError(deps, caller, 'ai.daily_report.generate_failed', raw.internal, {
      customerId: input.customerId,
      model,
      fallback,
      retryable: raw.retryable === true,
    });
  } else if (fallback) {
    // 先頭のモデルが使えず、切り替えた先のモデルで書けた(どのモデルで書いたかを残す)
    await deps.appLog.write({
      tenantId: caller.tenantId,
      level: 'WARN',
      action: 'ai.daily_report.model_fallback_succeeded',
      actorStaffId: caller.staffId,
      details: { customerId: input.customerId, model, firstModel },
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
    // 検証用の付帯情報(トークン数など)は記録に載せない
    output: errorCode ? null : { ...withoutDiagnostics(raw), warnings },
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

function withoutDiagnostics(draft: DailyReportDraft): Omit<DailyReportDraft, 'diagnostics'> {
  const { diagnostics: _diagnostics, ...rest } = draft;
  return rest;
}

/** 保育日報のプロンプトを組み立てるのに読む値(お客様・対象のお子様・家庭の★・マスター・プロンプト)。 */
export interface DailyReportPromptContext {
  recipient: CareRecipientRecord | null;
  profile: CustomerReportProfileRecord | null;
  masters: ReportAiMasters;
  template: ResolvedPrompt;
  companyPolicy: ResolvedPrompt;
  timeZone: string;
}

/**
 * 保育日報のプロンプトに使う値をトランザクションの中で読む(生成と運用のモデル比較の組み立て直しで同じ読み方)。
 * お客様が無ければ 404、対象のお子様がその世帯の子でなければ 400(resolveReportCareRecipient)。
 */
export async function loadDailyReportPromptContext(
  r: TenantRepositories,
  customerId: string,
  careRecipientId: string | null | undefined,
): Promise<DailyReportPromptContext> {
  const customer = await r.customers.findById(customerId);
  if (!customer) throw notFound('お客様が見つかりません', 'customer_not_found');
  const recipient = await resolveReportCareRecipient(r, customerId, careRecipientId);
  const [profile, masters, template, companyPolicy, tenant] = await Promise.all([
    r.customerReportProfiles.find(customerId),
    r.reportAi.loadActive(),
    resolvePrompt(r, AI_PROMPT_KEYS.DAILY_REPORT_GENERATE),
    resolvePrompt(r, AI_PROMPT_KEYS.DAILY_REPORT_COMPANY_POLICY),
    r.tenant(),
  ]);
  return { recipient, profile, masters, template, companyPolicy, timeZone: tenant.timezone };
}

/** 読んだ値とメモ・時間情報・PSI から保育日報のプロンプトを組み立てる(月齢は onDate で数える)。 */
export function buildDailyReportPrompt(
  context: DailyReportPromptContext,
  input: { text: string; timeInfo: string; onDate: string; riskRating: number | null },
): { assembled: AssembledDailyReportPrompt; childAgeMonths: number | null } {
  const birthDate = context.recipient?.birthDate ?? null;
  const childAgeMonths = birthDate ? ageInMonths(birthDate, input.onDate) : null;
  const assembled = assembleDailyReportPrompt({
    template: context.template.body,
    companyPolicy: context.companyPolicy.body,
    anonymizedText: input.text,
    timeInfo: input.timeInfo,
    childAgeMonths,
    educationLevel: context.profile?.educationLevel ?? null,
    riskRating: input.riskRating,
    masters: context.masters,
  });
  return { assembled, childAgeMonths };
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

export interface AccidentReportGeneration {
  draft: AccidentReportDraft | AccidentReportDraftError;
  /** この生成で使ったモデル(API キーが無ければ null)。 */
  model: string | null;
  /** 失敗で、別のモデルで試し直す意味があるか(成功・API キー未設定・キーの誤りは false)。 */
  retryable: boolean;
}

/**
 * GAS版GeminiReport.js generateAccidentReportに対応。失敗時は draft が {error}。
 * モデルの選び方・切り替えは保育日報と同じ(input.model。画面が listReportModels の順に呼び直す)。失敗は ERROR
 * `ai.accident_report.generate_failed`(モデル名つき)、切り替え先で書けたら WARN `ai.accident_report.model_fallback_succeeded`。
 */
export async function generateAccidentReportDraft(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  input: { text: string; start?: string | undefined; end?: string | undefined; model?: string | undefined },
): Promise<AccidentReportGeneration> {
  const reportAi = await resolveReportAiPort(deps, caller.tenantId);
  const { model, firstModel } = await chooseReportModel(reportAi, input.model);
  const template = await deps.uow.run(caller.tenantId, (r) =>
    resolvePrompt(r, AI_PROMPT_KEYS.ACCIDENT_REPORT_GENERATE),
  );
  const prompt = renderAccidentReportPrompt(
    template.body,
    input.text,
    accidentTimeInfo(input.start, input.end),
  );
  const result = await reportAi.generateAccidentReport({ prompt, ...(model !== null ? { model } : {}) });
  const fallback = model !== null && model !== firstModel;
  if ('error' in result) {
    const retryable = model !== null && result.retryable === true;
    await logAiError(deps, caller, 'ai.accident_report.generate_failed', result.error, {
      model,
      fallback,
      retryable,
    });
    return { draft: { error: result.error }, model, retryable };
  }
  if (fallback) {
    await deps.appLog.write({
      tenantId: caller.tenantId,
      level: 'WARN',
      action: 'ai.accident_report.model_fallback_succeeded',
      actorStaffId: caller.staffId,
      details: { model, firstModel },
      ...caller.meta,
    });
  }
  return { draft: result, model, retryable: false };
}

/**
 * GAS版GeminiReport.js extractAmountFromImageに対応。失敗時も空値のフォールバックを返す。
 * モデルは Flash-Lite 系だけを順に(最大 MAX_OCR_MODEL_ATTEMPTS)サーバーの中で試す(画面は変えない)。試し直す意味の
 * ある失敗(混雑・上限・モデルが無い・時間切れ)のときだけ次のモデルに進み、失敗ごとに ERROR `ai.receipt_ocr.failed`
 * (モデル名つき)、切り替え先で読めたら WARN `ai.receipt_ocr.model_fallback_succeeded` を残す。
 */
export async function extractReceiptAmount(
  deps: ReportAiDeps,
  caller: ReportAiCaller,
  base64Image: string,
): Promise<ReceiptOcrResult> {
  const reportAi = await resolveReportAiPort(deps, caller.tenantId);
  const chain = reportAi.hasApiKey ? buildOcrModelChain(await availableModelsOf(reportAi)) : [];
  const models: (string | null)[] = chain.length > 0 ? chain : [null];
  let last: ReceiptOcrResult = { amount: '', storeName: '', receiptDate: '' };
  for (const [attempt, model] of models.entries()) {
    const { retryable, ...result } = await reportAi.extractReceiptAmount({
      base64Image,
      ...(model !== null ? { model } : {}),
    });
    last = result;
    if (!result.error) {
      if (attempt > 0) {
        await deps.appLog.write({
          tenantId: caller.tenantId,
          level: 'WARN',
          action: 'ai.receipt_ocr.model_fallback_succeeded',
          actorStaffId: caller.staffId,
          details: { model, firstModel: models[0], attempt: attempt + 1 },
          ...caller.meta,
        });
      }
      return result;
    }
    const canRetry = model !== null && retryable === true;
    await logAiError(deps, caller, 'ai.receipt_ocr.failed', result.error, {
      model,
      attempt: attempt + 1,
      retryable: canRetry,
    });
    if (!canRetry) break;
  }
  return last;
}
