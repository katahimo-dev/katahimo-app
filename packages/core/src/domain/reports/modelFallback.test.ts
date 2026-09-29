import { describe, expect, it } from 'vitest';
import {
  buildOcrModelChain,
  buildReportModelChain,
  FALLBACK_FLASH_LITE_MODELS,
  FALLBACK_FLASH_MODELS,
  MAX_OCR_MODEL_ATTEMPTS,
  MAX_REPORT_MODEL_ATTEMPTS,
  MAX_REPORT_MODELS_PER_FAMILY,
  reportModelFamilyOf,
} from './modelFallback';

describe('日報AIのモデルの順番(自動で選ぶ)', () => {
  it('Flash 系 → Flash-Lite 系(系統ごとに 4つまで)。系統の中は -latest が先頭、次に新しい版から(3桁の無い名前が先)', () => {
    const available = [
      'gemini-2.0-flash-lite-001',
      'gemini-flash-lite-latest',
      'gemini-2.0-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-3-flash',
      'gemini-2.0-flash-001',
      'gemini-2.0-flash-002',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ];
    expect(buildReportModelChain(available)).toEqual([
      'gemini-flash-latest',
      'gemini-3-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite-001',
    ]);
  });

  it('Flash 系の一覧が長くても Flash-Lite 系を追い出さない(合わせて 8つまで)', () => {
    const flash = ['gemini-flash-latest', ...[3, 2.5, 2, 1.5, 1].map((v) => `gemini-${v}-flash`)];
    const lite = ['gemini-flash-lite-latest', ...[3, 2.5, 2, 1.5].map((v) => `gemini-${v}-flash-lite`)];
    const chain = buildReportModelChain([...flash, ...lite]);
    expect(chain).toEqual([...flash.slice(0, MAX_REPORT_MODELS_PER_FAMILY), ...lite.slice(0, 4)]);
    expect(chain).toHaveLength(MAX_REPORT_MODEL_ATTEMPTS);
  });

  it('preview・exp・画像/音声向けなどの派生と、Flash 以外のモデルは使わない(一覧に系統の名前が無ければ既知の名前)', () => {
    const available = [
      'gemini-2.5-flash-preview-09-2025',
      'gemini-2.0-flash-exp',
      'gemini-2.5-flash-image',
      'gemini-2.5-flash-preview-tts',
      'gemini-live-2.5-flash',
      'gemini-2.5-pro',
      'gemma-3-27b-it',
    ];
    // 一覧に Flash / Flash-Lite 系の名前が無ければ、系統ごとに既知の名前を使う
    expect(buildReportModelChain(available)).toEqual([
      ...FALLBACK_FLASH_MODELS,
      ...FALLBACK_FLASH_LITE_MODELS,
    ]);
    expect(buildOcrModelChain(available)).toEqual([...FALLBACK_FLASH_LITE_MODELS]);
  });

  it('片方の系統だけ一覧に無ければ、その系統だけ既知の名前を使う', () => {
    expect(buildReportModelChain(['gemini-2.5-flash', 'gemini-2.5-pro'])).toEqual([
      'gemini-2.5-flash',
      ...FALLBACK_FLASH_LITE_MODELS,
    ]);
    expect(buildOcrModelChain(['gemini-2.5-flash'])).toEqual([...FALLBACK_FLASH_LITE_MODELS]);
    expect(buildReportModelChain(['gemini-2.0-flash-lite'])).toEqual([
      ...FALLBACK_FLASH_MODELS,
      'gemini-2.0-flash-lite',
    ]);
  });

  it('一覧が読めなければ既知の名前(-latest が先頭)を使う', () => {
    expect(buildReportModelChain(null)).toEqual([...FALLBACK_FLASH_MODELS, ...FALLBACK_FLASH_LITE_MODELS]);
    expect(FALLBACK_FLASH_MODELS[0]).toBe('gemini-flash-latest');
    expect(FALLBACK_FLASH_LITE_MODELS[0]).toBe('gemini-flash-lite-latest');
  });

  it('領収書の読み取りは Flash-Lite 系だけを 3つまで', () => {
    expect(buildOcrModelChain(null)).toEqual([...FALLBACK_FLASH_LITE_MODELS]);
    expect(
      buildOcrModelChain([
        'gemini-2.5-flash',
        'gemini-2.0-flash-lite-001',
        'gemini-2.0-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-flash-lite-latest',
      ]),
    ).toEqual(['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite']);
    expect(MAX_OCR_MODEL_ATTEMPTS).toBe(3);
  });

  it('生成に使える名前の判定', () => {
    expect(reportModelFamilyOf('gemini-2.5-flash')).toBe('flash');
    expect(reportModelFamilyOf('gemini-2.0-flash-lite-001')).toBe('flash_lite');
    expect(reportModelFamilyOf('gemini-flash-lite-latest')).toBe('flash_lite');
    expect(reportModelFamilyOf('gemini-flash-latest')).toBe('flash');
    expect(reportModelFamilyOf('gemini-2.5-pro')).toBeNull();
    expect(reportModelFamilyOf('gemini-2.5-flash-preview-tts')).toBeNull();
  });
});
