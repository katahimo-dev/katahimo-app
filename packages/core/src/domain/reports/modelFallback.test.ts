import { describe, expect, it } from 'vitest';
import {
  buildReportModelChain,
  FALLBACK_FLASH_LITE_MODELS,
  FALLBACK_FLASH_MODELS,
  MAX_REPORT_MODEL_ATTEMPTS,
  reportModelFamilyOf,
} from './modelFallback';

describe('日報AIのモデルの切り替えの順番', () => {
  it('設定のモデル → Flash 系(新しい版から) → Flash-Lite 系(新しい版から)。-latest は系統の最後', () => {
    const available = [
      'gemini-2.0-flash-lite-001',
      'gemini-flash-lite-latest',
      'gemini-2.0-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-3-flash',
      'gemini-2.0-flash-001',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ];
    expect(buildReportModelChain('gemini-2.5-flash', available)).toEqual([
      'gemini-2.5-flash',
      'gemini-3-flash',
      'gemini-2.0-flash',
      'gemini-2.0-flash-001',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite-001',
      'gemini-flash-lite-latest',
    ]);
  });

  it('preview・exp・画像/音声向けなどの派生と、Flash 以外のモデルは使わない', () => {
    const available = [
      'gemini-2.5-flash-preview-09-2025',
      'gemini-2.0-flash-exp',
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-preview-tts',
      'gemini-live-2.5-flash',
      'gemini-2.5-pro',
      'gemma-3-27b-it',
    ];
    expect(buildReportModelChain('gemini-2.5-pro', available)).toEqual(['gemini-2.5-pro']);
  });

  it('一覧が読めなければ既知の名前を使い、上限で打ち切る。設定が無ければ空', () => {
    const chain = buildReportModelChain('custom-model', null);
    expect(chain).toEqual(
      ['custom-model', ...FALLBACK_FLASH_MODELS, ...FALLBACK_FLASH_LITE_MODELS].slice(0, 8),
    );
    expect(chain.length).toBeLessThanOrEqual(MAX_REPORT_MODEL_ATTEMPTS);
    expect(buildReportModelChain(null, ['gemini-2.5-flash'])).toEqual([]);
  });

  it('切り替え先に使える名前の判定', () => {
    expect(reportModelFamilyOf('gemini-2.5-flash')).toBe('flash');
    expect(reportModelFamilyOf('gemini-2.0-flash-lite-001')).toBe('flash_lite');
    expect(reportModelFamilyOf('gemini-flash-lite-latest')).toBe('flash_lite');
    expect(reportModelFamilyOf('gemini-2.5-pro')).toBeNull();
    expect(reportModelFamilyOf('gemini-2.5-flash-preview-tts')).toBeNull();
  });
});
