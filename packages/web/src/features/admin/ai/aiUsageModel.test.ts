import { AI_PROMPT_DEFINITIONS, AI_PROMPT_KEYS, type AiPromptView } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { summarizeAiUsage } from './aiUsageModel';

const emptyMasters = {
  keywords: [],
  ageBands: [],
  educationLevels: [],
  psiLevels: [],
  phrases: [],
  stanceRules: [],
};

function dailyPrompt(body?: string): AiPromptView {
  const d = AI_PROMPT_DEFINITIONS.find((p) => p.key === AI_PROMPT_KEYS.DAILY_REPORT_GENERATE);
  if (!d) throw new Error('no daily prompt');
  return {
    key: d.key,
    kind: d.kind,
    label: d.label,
    body: body ?? d.defaultBody,
    defaultBody: d.defaultBody,
    customized: body !== undefined,
    updatedAt: null,
    revision: 0,
  };
}

describe('summarizeAiUsage', () => {
  it('既定のプロンプトはすべての表の差し込みとキーワードの段落を持つ', () => {
    const s = summarizeAiUsage([dailyPrompt()], emptyMasters);
    expect(s.hasKeywordSection).toBe(true);
    expect(s.masters.every((m) => m.inPrompt)).toBe(true);
    expect(s.unusedMasters).toEqual([]);
    expect(s.dailyPromptCustomized).toBe(false);
  });

  it('差し込みを消したプロンプトでは、行のある表を「使われていない」にする(二重の括弧は差し込みではない)', () => {
    const masters = { ...emptyMasters, keywords: [{} as never], phrases: [{} as never] };
    const s = summarizeAiUsage([dailyPrompt('メモ: {anonymizedText}\n{{keywordTable}}')], masters);
    expect(s.hasKeywordSection).toBe(false);
    expect(s.unusedMasters.map((m) => m.table)).toEqual(['keywords', 'phrases']);
    expect(s.dailyPromptCustomized).toBe(true);
  });
});
