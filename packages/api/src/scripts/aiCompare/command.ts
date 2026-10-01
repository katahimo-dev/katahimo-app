import type { AppLogPort, ReportAiPort, TenantDirectoryPort, UnitOfWorkPort } from '@katahimo/core/ports';
import {
  checkCallBudget,
  loadReportAiComparisonCases,
  plannedCallCount,
  runReportAiComparison,
} from '@katahimo/core/usecases';
import { type AiCompareArgs, checkAiCompareTenant } from './args';
import { renderAiCompareHtml } from './html';
import { defaultAiCompareFileName, formatAiComparePlan, formatAiCompareProgress } from './output';

/** `pnpm ai:compare` の本体が使う依存(main が本物を、テストが偽物を渡す)。 */
export interface AiCompareCommandDeps {
  /** AI_COMPARE_TENANTS の値。 */
  allowList: string | undefined;
  tenants: Pick<TenantDirectoryPort, 'findBySlug'>;
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
  /** テナントの Gemini の実装(アプリと同じ決め方。resolveReportAiPort)。 */
  resolveReportAi(tenantId: string): Promise<ReportAiPort>;
  /** 書き出し先のファイル名を絶対パスにする(INIT_CWD から)。 */
  resolvePath(path: string): string;
  writeFile(path: string, content: string): Promise<void>;
  now(): Date;
  /** --blind のラベルの並べ替えの種。 */
  blindSeed(): string;
  /** 経過時間を測る時計(ミリ秒。テスト用)。 */
  clockMs?: () => number;
  log(line: string): void;
  warn(line: string): void;
}

export type AiCompareOutcome =
  | { status: 'refused'; message: string }
  | { status: 'planned'; calls: number }
  | { status: 'completed'; path: string; calls: number; failures: number };

/**
 * 運用のモデル比較の流れ。1回も呼ばずに止める確かめ(対象のテナント・見つからない生成・呼ぶ回数の上限)を先に
 * 全て行い、--dry-run は計画を出すだけ(Gemini を呼ばず、ファイルも操作ログも書かない)。
 */
export async function runAiCompareCommand(
  deps: AiCompareCommandDeps,
  args: AiCompareArgs,
): Promise<AiCompareOutcome> {
  const refused = checkAiCompareTenant(args.slug, deps.allowList);
  if (refused) return { status: 'refused', message: refused };
  const tenant = await deps.tenants.findBySlug(args.slug);
  if (!tenant) return { status: 'refused', message: `テナントが見つかりません: ${args.slug}` };

  const loaded = await loadReportAiComparisonCases(deps, tenant.id, {
    ...(args.generationIds.length > 0 ? { ids: args.generationIds } : {}),
    latest: args.latest,
    ...(args.since ? { since: args.since } : {}),
    rebuild: args.rebuild,
  });
  if (loaded.missingIds.length > 0) {
    return {
      status: 'refused',
      message: `保育日報の生成の記録が見つかりません: ${loaded.missingIds.join(', ')}`,
    };
  }
  for (const s of loaded.skipped) deps.warn(`[ai:compare] 飛ばします ${s.generationId}: ${s.reason}`);
  if (loaded.cases.length === 0) {
    return {
      status: 'refused',
      message: '比べられる保育日報の生成がありません(成功した生成が無い・条件に合わない)',
    };
  }
  const plan = {
    models: args.models,
    runs: args.runs,
    ...(args.thinkingBudget !== undefined ? { thinkingBudget: args.thinkingBudget } : {}),
  };
  const budget = checkCallBudget(loaded.cases.length, plan);
  if (budget) return { status: 'refused', message: budget };
  for (const line of formatAiComparePlan(args, loaded)) deps.log(line);
  const calls = plannedCallCount(loaded.cases.length, plan);
  if (args.dryRun) {
    deps.log('[ai:compare] dry-run: Gemini を呼ばず、何も書きません');
    return { status: 'planned', calls };
  }

  const reportAi = await deps.resolveReportAi(tenant.id);
  if (!reportAi.hasApiKey) {
    deps.warn(
      '[ai:compare] Gemini の API キーがありません(テナントの設定にも GEMINI_API_KEY にも無い)。どの呼び出しも失敗として記録します',
    );
  }
  const results = await runReportAiComparison(
    {
      reportAi,
      ...(deps.clockMs ? { now: deps.clockMs } : {}),
      onProgress: (done, total, result) => deps.log(formatAiCompareProgress(done, total, result)),
    },
    loaded,
    plan,
  );
  const failures = results.filter((r) => !r.ok).length;
  const generatedAt = deps.now();
  const html = renderAiCompareHtml({
    tenantSlug: args.slug,
    generatedAt,
    timeZone: loaded.timeZone,
    models: args.models,
    runs: args.runs,
    thinkingBudget: args.thinkingBudget,
    rebuild: args.rebuild,
    blind: args.blind,
    blindSeed: deps.blindSeed(),
    cases: loaded.cases,
    results,
    skipped: loaded.skipped,
    missingIds: loaded.missingIds,
  });
  const path = deps.resolvePath(
    args.out ?? defaultAiCompareFileName(args.slug, generatedAt, loaded.timeZone),
  );
  await deps.writeFile(path, html);
  // 件数・モデル・ID だけ(プロンプト・メモ・答えは書かない)。失敗した呼び出しがあれば WARN
  await deps.appLog.write({
    tenantId: tenant.id,
    level: failures > 0 ? 'WARN' : 'INFO',
    action: 'ai.compare.completed',
    actorStaffId: null,
    details: {
      models: args.models,
      runs: args.runs,
      rebuild: args.rebuild,
      thinkingBudget: args.thinkingBudget ?? null,
      blind: args.blind,
      generationIds: loaded.cases.map((c) => c.generationId),
      skippedIds: loaded.skipped.map((s) => s.generationId),
      calls: results.length,
      failures,
    },
  });
  deps.log(`[ai:compare] 書き出しました: ${path}`);
  deps.warn(
    '[ai:compare] このファイルにはテナントのデータ(メモ・日報の文)が含まれます。審査の担当者の外に渡さず、リポジトリにも入れないでください',
  );
  return { status: 'completed', path, calls: results.length, failures };
}
