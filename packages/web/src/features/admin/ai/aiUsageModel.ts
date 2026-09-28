import { AI_PROMPT_KEYS, type AiPromptView, type ReportAiMastersResponse } from '@katahimo/shared';

/**
 * 日報AIの調整の表が、保育日報のプロンプトのどの差し込みに入るか。プロンプトにその差し込みが無ければ、表に行があっても
 * AI には渡らない(プロンプトとマスターは「どちらか」ではなく、プロンプト=指示文の型に、マスターから選んだ言葉を差し込む)。
 */
export const MASTER_PLACEHOLDERS = [
  { table: 'keywords', label: 'キーワード', placeholders: ['keywordTable'] },
  { table: 'ageBands', label: '年齢帯', placeholders: ['ageBandGuide'] },
  { table: 'educationLevels', label: '教育思考★', placeholders: ['levelGuide', 'eduLevel'] },
  { table: 'psiLevels', label: 'PSI', placeholders: ['psi'] },
  { table: 'phrases', label: '表現', placeholders: ['warmPhrases', 'avoidPhrases'] },
  { table: 'stanceRules', label: '見ていた人スタンス', placeholders: ['stanceGuide'] },
] as const satisfies readonly {
  table: keyof ReportAiMastersResponse;
  label: string;
  placeholders: readonly string[];
}[];

export interface MasterUsage {
  table: (typeof MASTER_PLACEHOLDERS)[number]['table'];
  label: string;
  rows: number;
  /** 保育日報のプロンプトに差し込みがある(表の行が AI に渡る)。 */
  inPrompt: boolean;
}

export interface AiUsageSummary {
  /** 保育日報のプロンプトを既定から変えているか。 */
  dailyPromptCustomized: boolean;
  /** プロンプトに {#keywords}…{/keywords} の段落がある(キーワードが1件以上あるときだけ使われる)。 */
  hasKeywordSection: boolean;
  masters: MasterUsage[];
  /** 表に行があるのに、プロンプトに差し込みが無い(AI に渡っていない)表。 */
  unusedMasters: MasterUsage[];
}

const hasPlaceholder = (body: string, name: string) => new RegExp(`(?<!\\{)\\{${name}\\}(?!\\})`).test(body);

export function summarizeAiUsage(
  prompts: readonly AiPromptView[],
  masters: ReportAiMastersResponse,
): AiUsageSummary {
  const daily = prompts.find((p) => p.key === AI_PROMPT_KEYS.DAILY_REPORT_GENERATE);
  const body = daily?.body ?? '';
  const usage = MASTER_PLACEHOLDERS.map((m) => ({
    table: m.table,
    label: m.label,
    rows: masters[m.table].length,
    inPrompt: m.placeholders.some((name) => hasPlaceholder(body, name)),
  }));
  return {
    dailyPromptCustomized: daily?.customized ?? false,
    hasKeywordSection: /^\s*\{#keywords\}\s*$/m.test(body) && /^\s*\{\/keywords\}\s*$/m.test(body),
    masters: usage,
    unusedMasters: usage.filter((m) => m.rows > 0 && !m.inPrompt),
  };
}
