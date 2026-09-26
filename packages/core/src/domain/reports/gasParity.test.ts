import { AI_PROMPT_KEYS, findAiPromptDefinition } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { GAS_LEGACY_AVAILABLE, loadGasDeclarations } from '../../testSupport/gasLegacy';
import { assembleDailyReportPrompt, dailyTimeInfo } from './promptAssembly';
import { EMPTY_REPORT_AI_MASTERS } from './reportAiMasters';

/**
 * 保育日報の生成プロンプトの組み立てを GAS版(legacy サブモジュールの GeminiReport.js generateReportWithWarnings)と
 * 突き合わせる。既定の文面はお客様の変更案に変えたため GAS版と違うが、次は GAS版と同じであることを確かめる。
 * - 時間情報の作り方と、GAS版の文面をそのまま使ったとき(AIプロンプトで GAS版の文面を保存したテナント)の組み立ての
 *   結果(日報AIのマスターが空なら、GAS版がモデルに送る文字列と1文字も違わない)
 * - 既定の文面が必須情報チェックの3項目・warnings への列挙・社内向け/保護者向けの2つの出力を保っていること
 * 応答のスキーマの突き合わせは integrations/src/gemini/gasParity.test.ts。
 */

interface Captured {
  prompt: string;
  config: {
    responseMimeType: string;
    responseSchema: { required: string[]; properties: Record<string, unknown> };
  };
}

function loadGas(template: string | null) {
  const captured: Captured[] = [];
  const gas = loadGasDeclarations(
    { 'GeminiReport.js': ['PROMPT_KEYS', 'DEFAULT_PROMPTS', 'generateReportWithWarnings'] },
    {
      PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-key' }) },
      getPrompt: () => template,
      getGeminiModelForReport_: () => 'test-model',
      logToBuffer: () => undefined,
      callGemini: (_key: string, parts: { text: string }[], config: Captured['config']) => {
        captured.push({ prompt: parts[0]?.text ?? '', config });
        return { warnings: [], internal: 'i', customer: 'c' };
      },
    },
  );
  return { gas, captured };
}

describe.skipIf(!GAS_LEGACY_AVAILABLE)('保育日報の生成プロンプト(GAS版との一致)', () => {
  it('GAS版の文面を使うテナントでは、マスターが空ならモデルに送る文字列が GAS版と同じ', () => {
    const { gas: defaults } = loadGas(null);
    const gasDefault = (defaults.DEFAULT_PROMPTS as unknown as Record<string, string>)[
      (defaults.PROMPT_KEYS as unknown as Record<string, string>).GENERATE_WITH_WARNINGS as string
    ] as string;
    for (const input of [
      { text: '今日は公園で遊びました。\n2行目', start: '09:00', end: '12:00' },
      { text: '時間なし', start: '09:00', end: '' },
      { text: '記号 { } [ ] を含むメモ', start: '', end: '' },
    ]) {
      const { gas, captured } = loadGas(gasDefault);
      gas.generateReportWithWarnings?.(input);
      const ours = assembleDailyReportPrompt({
        template: gasDefault,
        companyPolicy: '',
        anonymizedText: input.text,
        timeInfo: dailyTimeInfo(input.start, input.end),
        childAgeMonths: null,
        educationLevel: null,
        riskRating: null,
        masters: EMPTY_REPORT_AI_MASTERS,
      });
      expect(ours.prompt).toBe(captured[0]?.prompt);
    }
  });

  it('既定の文面は必須情報チェックの3項目・warnings への列挙・社内向け/保護者向けの出力を GAS版から保つ', () => {
    const ours = findAiPromptDefinition(AI_PROMPT_KEYS.DAILY_REPORT_GENERATE)?.defaultBody ?? '';
    for (const item of ['訪問当日のサポート内容', 'お客様情報', '振り返り']) expect(ours).toContain(item);
    expect(ours).toContain('"warnings" 配列に列挙する');
    expect(ours).toContain('{anonymizedText}');
    expect(ours).toContain('{timeInfo}');
    for (const key of ['"warnings"', '"internal"', '"customer"']) expect(ours).toContain(key);
  });
});
