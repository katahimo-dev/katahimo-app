import { GAS_LEGACY_AVAILABLE, loadGasDeclarations } from '@katahimo/core/test-utils';
import { describe, expect, it } from 'vitest';
import { DAILY_REPORT_RESPONSE_SCHEMA } from './geminiAiPort';

/**
 * 保育日報の応答のスキーマを GAS版(legacy サブモジュールの GeminiReport.js generateReportWithWarnings)と
 * 突き合わせる: warnings / internal / customer が必須で型も同じ(日報AIで足した psi / eduLevel / usedKeywords は任意)。
 * プロンプトの組み立ての突き合わせは core/src/domain/reports/gasParity.test.ts。
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

describe.skipIf(!GAS_LEGACY_AVAILABLE)('保育日報の応答のスキーマ(GAS版との一致)', () => {
  it('応答のスキーマの必須の項目と型は GAS版と同じ(足した項目は任意)', () => {
    const { gas, captured } = loadGas(null);
    gas.generateReportWithWarnings?.({ text: 'メモ', start: '09:00', end: '12:00' });
    const gasSchema = captured[0]?.config.responseSchema;
    expect(captured[0]?.config.responseMimeType).toBe('application/json');
    expect(DAILY_REPORT_RESPONSE_SCHEMA.required).toEqual(gasSchema?.required);
    for (const key of gasSchema?.required ?? []) {
      expect(DAILY_REPORT_RESPONSE_SCHEMA.properties[key as 'warnings']).toEqual(gasSchema?.properties[key]);
    }
    expect(
      Object.keys(DAILY_REPORT_RESPONSE_SCHEMA.properties).filter((k) => !gasSchema?.properties[k]),
    ).toEqual(['psi', 'eduLevel', 'usedKeywords']);
  });
});
