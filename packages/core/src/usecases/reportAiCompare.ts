import { AI_PROMPT_KEYS } from '@katahimo/shared';
import {
  DomainError,
  enforceEscalationWarning,
  type ReportKeywordEntry,
  type ResolvedUsedKeywords,
  resolveUsedKeywords,
  zonedBusinessDate,
  zonedInstant,
} from '../domain';
import type { DailyReportDraft, ReportAiPort, ReportAiTokenUsage } from '../ports/ai';
import type { ReportAiComparisonSource } from '../ports/reportAi';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import { buildDailyReportPrompt, dailyReportErrorCodeOf, loadDailyReportPromptContext } from './reportAi';

/**
 * 運用のモデル比較(`pnpm ai:compare`。doc/07 の運用手順)。過去の保育日報の AI 生成(report_ai_generations)と
 * 同じプロンプトを、いくつかの Gemini のモデルに送り直して答えを並べる。審査用のテナントで、どのモデルで足りるかを
 * 決めるための道具で、アプリの画面からは使わない。
 * - 読むだけ(生成の記録も日報も書かない)。DB は Unit of Work の読み取りだけで、Gemini はその外で呼ぶ
 * - 既定は記録の prompt_text をそのまま送る。rebuild は記録のメモ(input_text)と今のテナントのプロンプト・
 *   マスター・家庭の★から、生成と同じ関数(loadDailyReportPromptContext / buildDailyReportPrompt)で組み立て直す
 * - プロンプト・メモ・答えは操作ログに書かない(呼び出し元が件数・モデル・ID だけを残す)
 */

/** 1回の比較の上限(誤って大量に呼んで課金しないように)。 */
export const AI_COMPARE_LIMITS = {
  /** 比べるモデルの数。 */
  maxModels: 4,
  /** 1つのモデルで同じプロンプトを送る回数。 */
  maxRuns: 3,
  /** 対象の生成の数(--latest・--generation)。 */
  maxCases: 50,
  /** --latest の既定。 */
  defaultLatest: 10,
  /** Gemini を呼ぶ回数の合計(生成 × モデル × 回数)。超えたら1回も呼ばずに止める。 */
  maxCalls: 200,
} as const;

/** 答えに使った語(resolveUsedKeywords の items)。 */
export type ComparisonUsedKeyword = ResolvedUsedKeywords['items'][number];

/** 答えの中身(日報の下書きの、比較で見せる項目)。 */
export interface ComparisonDraft {
  warnings: string[];
  internal: string;
  customer: string;
  psi?: number;
  eduLevel?: number;
}

/** 当時の生成(記録の値)。 */
export interface ComparisonOriginal {
  model: string | null;
  errorCode: string | null;
  draft: ComparisonDraft | null;
  usedKeywords: ComparisonUsedKeyword[];
  /** 記録の開始〜終了(DB の読み込みも含む。参考)。 */
  latencyMs: number;
}

/** 組み立て直したプロンプトの値(rebuild のときだけ)。 */
export interface ComparisonRebuilt {
  childAgeMonths: number | null;
  educationLevel: number;
  effectiveEducationLevel: number | null;
  escalationRequired: boolean;
  candidateCount: number;
}

/** 比べる1件(過去の生成1回)。 */
export interface ComparisonCase {
  generationId: string;
  createdAt: Date;
  /** 生成した日(テナントの業務日)。 */
  businessDate: string;
  childAgeMonths: number | null;
  educationLevel: number;
  effectiveEducationLevel: number | null;
  riskRating: number | null;
  escalationRequired: boolean;
  /** スタッフのメモ(記録の input_text)。 */
  inputText: string;
  timeInfo: string;
  /** 送るプロンプト。 */
  prompt: string;
  promptSource: 'original' | 'rebuilt';
  rebuilt: ComparisonRebuilt | null;
  /** 答えの語を突き合わせる候補(記録の候補か、組み立て直した候補)。 */
  candidates: ReportKeywordEntry[];
  original: ComparisonOriginal;
  /** 結び付いた日報にスタッフが保存した文(無ければ null)。 */
  savedReport: { internalText: string; customerText: string } | null;
}

/** 比べられなかった生成と、その理由(画面・端末に出す)。 */
export interface ComparisonSkip {
  generationId: string;
  reason: string;
}

export interface LoadedComparison {
  cases: ComparisonCase[];
  skipped: ComparisonSkip[];
  /** --generation で指定したのに無かった ID。 */
  missingIds: string[];
  /** 今のテナントのキーワード表(答えの語が表にあるかの突き合わせ)。 */
  keywords: ReportKeywordEntry[];
  timeZone: string;
}

export interface ComparisonSelection {
  /** 指定した生成(成否を問わない)。無ければ latest。 */
  ids?: readonly string[];
  /** 成功した生成を新しい順に何件か。 */
  latest: number;
  /** この業務日('YYYY-MM-DD'。テナントのタイムゾーン)以降に作った生成だけ。 */
  since?: string;
  rebuild: boolean;
}

function draftOf(value: Record<string, unknown> | DailyReportDraft | null): ComparisonDraft | null {
  if (!value) return null;
  const v = value as Record<string, unknown>;
  const draft: ComparisonDraft = {
    warnings: Array.isArray(v.warnings) ? v.warnings.filter((w): w is string => typeof w === 'string') : [],
    internal: typeof v.internal === 'string' ? v.internal : '',
    customer: typeof v.customer === 'string' ? v.customer : '',
  };
  if (typeof v.psi === 'number') draft.psi = v.psi;
  if (typeof v.eduLevel === 'number') draft.eduLevel = v.eduLevel;
  return draft;
}

function usedAnswersOf(value: Record<string, unknown> | null): unknown[] {
  const used = value?.usedKeywords;
  return Array.isArray(used) ? used : [];
}

/** 生成の記録を比べる1件にする(rebuild でなければ記録のプロンプトのまま)。 */
function caseOf(
  source: ReportAiComparisonSource,
  input: {
    timeZone: string;
    keywords: ReportKeywordEntry[];
    candidates: ReportKeywordEntry[];
    savedReport: ComparisonCase['savedReport'];
    rebuilt: { prompt: string; candidates: ReportKeywordEntry[]; values: ComparisonRebuilt } | null;
  },
): ComparisonCase {
  return {
    generationId: source.id,
    createdAt: source.createdAt,
    businessDate: zonedBusinessDate(source.createdAt, input.timeZone),
    childAgeMonths: source.childAgeMonths,
    educationLevel: source.educationLevel,
    effectiveEducationLevel: source.effectiveEducationLevel,
    riskRating: source.riskRating,
    escalationRequired: source.escalationRequired,
    inputText: source.inputText,
    timeInfo: source.timeInfo,
    prompt: input.rebuilt?.prompt ?? source.promptText,
    promptSource: input.rebuilt ? 'rebuilt' : 'original',
    rebuilt: input.rebuilt?.values ?? null,
    candidates: input.rebuilt?.candidates ?? input.candidates,
    original: {
      model: source.model,
      errorCode: source.errorCode,
      draft: draftOf(source.output),
      usedKeywords: resolveUsedKeywords(usedAnswersOf(source.output), input.candidates, input.keywords).items,
      latencyMs: Math.max(0, source.finishedAt.getTime() - source.startedAt.getTime()),
    },
    savedReport: input.savedReport,
  };
}

/**
 * 比べる生成を読む(1トランザクション、読むだけ)。rebuild で組み立て直せない生成(お客様・お子様がもう無い等)は
 * 飛ばして skipped に理由を残す。
 */
export async function loadReportAiComparisonCases(
  deps: { uow: UnitOfWorkPort },
  tenantId: string,
  selection: ComparisonSelection,
): Promise<LoadedComparison> {
  return deps.uow.run(tenantId, async (r) => {
    const tenant = await r.tenant();
    const timeZone = tenant.timezone;
    const ids = selection.ids && selection.ids.length > 0 ? [...new Set(selection.ids)] : undefined;
    const sources = await r.reportAiGenerations.listForComparison({
      promptKey: AI_PROMPT_KEYS.DAILY_REPORT_GENERATE,
      ...(ids ? { ids } : {}),
      limit: ids ? ids.length : selection.latest,
      ...(selection.since && !ids ? { since: zonedInstant(selection.since, 0, timeZone) } : {}),
    });
    const found = new Set(sources.map((s) => s.id));
    const missingIds = ids ? ids.filter((id) => !found.has(id)) : [];
    const masters = await r.reportAi.loadActive();
    const cases: ComparisonCase[] = [];
    const skipped: ComparisonSkip[] = [];
    for (const source of sources) {
      const candidates = await r.reportAi.findKeywordsByIds(source.candidateKeywordIds);
      let savedReport: ComparisonCase['savedReport'] = null;
      if (source.careRecordId) {
        const record = await r.careRecords.findById(source.careRecordId);
        if (record?.recordType === 'daily_report' && 'internalText' in record.body) {
          savedReport = { internalText: record.body.internalText, customerText: record.body.customerText };
        }
      }
      let rebuilt: Parameters<typeof caseOf>[1]['rebuilt'] = null;
      if (selection.rebuild) {
        try {
          const context = await loadDailyReportPromptContext(r, source.customerId, source.careRecipientId);
          const { assembled, childAgeMonths } = buildDailyReportPrompt(context, {
            text: source.inputText,
            timeInfo: source.timeInfo,
            onDate: zonedBusinessDate(source.startedAt, timeZone),
            riskRating: source.riskRating,
          });
          rebuilt = {
            prompt: assembled.prompt,
            candidates: assembled.candidates,
            values: {
              childAgeMonths,
              educationLevel: assembled.adjustment.educationLevel,
              effectiveEducationLevel: assembled.adjustment.effectiveEducationLevel,
              escalationRequired: assembled.adjustment.escalationRequired,
              candidateCount: assembled.candidates.length,
            },
          };
        } catch (e) {
          if (!(e instanceof DomainError)) throw e;
          skipped.push({
            generationId: source.id,
            reason: `プロンプトを組み立て直せません(${e.reason ?? e.code}: ${e.message})`,
          });
          continue;
        }
      }
      cases.push(caseOf(source, { timeZone, keywords: masters.keywords, candidates, savedReport, rebuilt }));
    }
    return { cases, skipped, missingIds, keywords: masters.keywords, timeZone };
  });
}

/** 比べ方(モデル・回数・思考の量)。 */
export interface ComparisonPlanInput {
  models: readonly string[];
  runs: number;
  thinkingBudget?: number;
}

/** 呼ぶ回数(生成 × モデル × 回数)。 */
export function plannedCallCount(
  caseCount: number,
  plan: Pick<ComparisonPlanInput, 'models' | 'runs'>,
): number {
  return caseCount * plan.models.length * plan.runs;
}

/** 呼ぶ回数が上限内か(超えていれば日本語の理由。1回も呼ばずに止める)。 */
export function checkCallBudget(
  caseCount: number,
  plan: Pick<ComparisonPlanInput, 'models' | 'runs'>,
): string | null {
  const calls = plannedCallCount(caseCount, plan);
  if (calls > AI_COMPARE_LIMITS.maxCalls) {
    return `Gemini を呼ぶ回数が上限を超えます(${caseCount}件 × ${plan.models.length}モデル × ${plan.runs}回 = ${calls}回 > ${AI_COMPARE_LIMITS.maxCalls}回)。件数・モデル・回数を減らしてください`;
  }
  return null;
}

/** モデル1回の呼び出しの結果。 */
export interface ComparisonCallResult {
  generationId: string;
  model: string;
  /** 何回目か(1〜)。 */
  run: number;
  ok: boolean;
  /** 失敗の種類(api_key_missing / api_error)。成功は null。 */
  errorCode: string | null;
  /** 失敗の説明(Gemini の応答の本文は載せない。短く切る)。 */
  errorMessage: string | null;
  latencyMs: number;
  draft: ComparisonDraft | null;
  /** 応答が日報のスキーマどおりか(失敗は false)。 */
  jsonValid: boolean;
  shapeIssues: string[];
  usage: ReportAiTokenUsage | null;
  usedKeywords: ComparisonUsedKeyword[];
}

/** 失敗の説明から Gemini の応答の本文(「[詳細]」以降)を落として短くする。 */
export function safeErrorMessage(internal: string): string {
  const head = internal.split('\n\n[詳細]')[0] ?? '';
  return head.trim().slice(0, 200);
}

/** 1回の呼び出しの結果を作る(純関数。runReportAiComparison とテストで使う)。 */
export function comparisonCallResultOf(
  testCase: ComparisonCase,
  keywords: readonly ReportKeywordEntry[],
  input: { model: string; run: number; latencyMs: number; raw: DailyReportDraft },
): ComparisonCallResult {
  const { raw } = input;
  const errorCode = dailyReportErrorCodeOf(raw);
  const base = {
    generationId: testCase.generationId,
    model: input.model,
    run: input.run,
    latencyMs: input.latencyMs,
    usage: raw.diagnostics?.usage ?? null,
  };
  if (errorCode) {
    return {
      ...base,
      ok: false,
      errorCode,
      errorMessage: safeErrorMessage(raw.internal),
      draft: null,
      jsonValid: false,
      shapeIssues: [],
      usedKeywords: [],
    };
  }
  const escalationRequired = testCase.rebuilt?.escalationRequired ?? testCase.escalationRequired;
  const draft = draftOf(raw) as ComparisonDraft;
  // 画面と同じく、PSI 1 は AI の答えに関わらず「管理者へ連絡」を入れる
  if (escalationRequired) draft.warnings = enforceEscalationWarning(draft.warnings);
  const shapeIssues = raw.diagnostics?.shapeIssues ?? [];
  return {
    ...base,
    ok: true,
    errorCode: null,
    errorMessage: null,
    draft,
    jsonValid: shapeIssues.length === 0,
    shapeIssues,
    usedKeywords: resolveUsedKeywords(raw.usedKeywords, testCase.candidates, keywords).items,
  };
}

export interface ComparisonRunDeps {
  reportAi: ReportAiPort;
  /** 経過時間を測る時計(ミリ秒)。既定は performance.now。 */
  now?: () => number;
  /** 1回呼ぶごとの進み具合(端末に出す)。 */
  onProgress?: (done: number, total: number, result: ComparisonCallResult) => void;
}

/**
 * 全ての生成 × モデル × 回数を順に呼ぶ(並べて呼ぶと所要時間が比べられず、回数の上限にも当たりやすいため1つずつ)。
 * 失敗は例外にせず結果に残す。DB には触れない。
 */
export async function runReportAiComparison(
  deps: ComparisonRunDeps,
  loaded: Pick<LoadedComparison, 'cases' | 'keywords'>,
  plan: ComparisonPlanInput,
): Promise<ComparisonCallResult[]> {
  const budget = checkCallBudget(loaded.cases.length, plan);
  if (budget) throw new Error(budget);
  const now = deps.now ?? (() => performance.now());
  const total = plannedCallCount(loaded.cases.length, plan);
  const results: ComparisonCallResult[] = [];
  for (const testCase of loaded.cases) {
    for (const model of plan.models) {
      for (let run = 1; run <= plan.runs; run++) {
        const started = now();
        let raw: DailyReportDraft;
        try {
          raw = await deps.reportAi.generateDailyReport({
            prompt: testCase.prompt,
            model,
            ...(plan.thinkingBudget !== undefined ? { thinkingBudget: plan.thinkingBudget } : {}),
          });
        } catch (e) {
          raw = {
            warnings: ['API Error'],
            internal: `System Error: ${e instanceof Error ? e.name : 'unknown'}`,
            customer: '',
          };
        }
        const result = comparisonCallResultOf(testCase, loaded.keywords, {
          model,
          run,
          latencyMs: Math.max(0, Math.round(now() - started)),
          raw,
        });
        results.push(result);
        deps.onProgress?.(results.length, total, result);
      }
    }
  }
  return results;
}

/** モデルごとのまとめ(HTML の先頭の表)。平均は値のある呼び出しだけで割る(無ければ null)。 */
export interface ComparisonModelSummary {
  model: string;
  calls: number;
  successes: number;
  jsonValid: number;
  avgLatencyMs: number | null;
  avgPromptTokens: number | null;
  avgCandidatesTokens: number | null;
  avgThoughtsTokens: number | null;
  usedKeywords: number;
  notOffered: number;
  unknown: number;
}

const average = (values: number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/** 結果をモデルごとにまとめる(並びは models の順)。所要時間の平均は成功した呼び出しだけ。 */
export function summarizeReportAiComparison(
  models: readonly string[],
  results: readonly ComparisonCallResult[],
): ComparisonModelSummary[] {
  return models.map((model) => {
    const mine = results.filter((r) => r.model === model);
    const ok = mine.filter((r) => r.ok);
    const tokens = (field: keyof ReportAiTokenUsage) =>
      average(ok.flatMap((r) => (typeof r.usage?.[field] === 'number' ? [r.usage[field] as number] : [])));
    const count = (status: ComparisonUsedKeyword['status']) =>
      ok.reduce((n, r) => n + r.usedKeywords.filter((k) => k.status === status).length, 0);
    return {
      model,
      calls: mine.length,
      successes: ok.length,
      jsonValid: mine.filter((r) => r.jsonValid).length,
      avgLatencyMs: average(ok.map((r) => r.latencyMs)),
      avgPromptTokens: tokens('promptTokens'),
      avgCandidatesTokens: tokens('candidatesTokens'),
      avgThoughtsTokens: tokens('thoughtsTokens'),
      usedKeywords: count('used'),
      notOffered: count('not_offered'),
      unknown: count('unknown'),
    };
  });
}
