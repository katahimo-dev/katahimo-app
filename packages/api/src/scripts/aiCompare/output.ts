import type { ComparisonCallResult, LoadedComparison } from '@katahimo/core/usecases';
import { plannedCallCount } from '@katahimo/core/usecases';
import type { AiCompareArgs } from './args';

/** 既定の書き出し先のファイル名 `ai-compare-<slug>-<yyyyMMddHHmm>.html`(テナントのタイムゾーンの時刻)。 */
export function defaultAiCompareFileName(slug: string, at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `ai-compare-${slug}-${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}.html`;
}

/** 呼ぶ前に端末に出す計画(対象の件 × モデル × 回数と、呼ぶ回数の合計)。 */
export function formatAiComparePlan(
  args: Pick<AiCompareArgs, 'models' | 'runs' | 'rebuild' | 'thinkingBudget' | 'blind'>,
  loaded: Pick<LoadedComparison, 'cases' | 'skipped'>,
): string[] {
  const calls = plannedCallCount(loaded.cases.length, args);
  const lines = [
    `[ai:compare] 対象 ${loaded.cases.length}件 × モデル ${args.models.length}つ(${args.models.join(', ')}) × ${args.runs}回 = Gemini を ${calls}回呼びます`,
    `[ai:compare] プロンプト: ${args.rebuild ? '今の設定で組み立て直す' : '当時のまま'} ・ 思考の量: ${args.thinkingBudget ?? 'モデルの既定'}${args.blind ? ' ・ モデル名を隠す' : ''}`,
  ];
  for (const c of loaded.cases) {
    lines.push(
      `  ${c.generationId}  ${c.businessDate}  当時のモデル=${c.original.model ?? '-'}  ★${c.educationLevel}  PSI=${c.riskRating ?? '未評価'}  候補の語=${c.candidates.length}${c.savedReport ? '  保存した日報あり' : ''}`,
    );
  }
  for (const s of loaded.skipped) lines.push(`  (飛ばす) ${s.generationId}: ${s.reason}`);
  return lines;
}

/** 1回呼ぶごとの進み具合の1行(文は出さない)。 */
export function formatAiCompareProgress(done: number, total: number, result: ComparisonCallResult): string {
  const outcome = result.ok
    ? `成功${result.jsonValid ? '' : '(JSON の形が違う)'}`
    : `失敗(${result.errorCode}: ${result.errorMessage})`;
  return `[ai:compare] ${done}/${total} ${result.generationId} ${result.model} ${result.run}回目: ${outcome} ${(result.latencyMs / 1000).toFixed(1)}秒`;
}
