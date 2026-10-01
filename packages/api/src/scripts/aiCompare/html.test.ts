import type { ComparisonCallResult, ComparisonCase } from '@katahimo/core/usecases';
import { describe, expect, it } from 'vitest';
import { type AiCompareReport, blindLabelsOf, escapeHtml, renderAiCompareHtml, seededShuffle } from './html';

const XSS = '<script>alert("x")</script>';

function testCase(id: string, overrides: Partial<ComparisonCase> = {}): ComparisonCase {
  return {
    generationId: id,
    createdAt: new Date('2026-09-25T03:00:00Z'),
    businessDate: '2026-09-25',
    childAgeMonths: 14,
    educationLevel: 2,
    effectiveEducationLevel: 2,
    riskRating: null,
    escalationRequired: false,
    inputText: `メモ ${XSS}`,
    timeInfo: '09:00〜12:00',
    prompt: `プロンプト ${XSS}`,
    promptSource: 'original',
    rebuilt: null,
    candidates: [],
    original: {
      model: 'gemini-flash-latest',
      errorCode: null,
      draft: { warnings: [XSS], internal: `当時 ${XSS}`, customer: '当時の保護者' },
      usedKeywords: [{ code: 'K01', keyword: '見守り<b>', status: 'used' }],
      latencyMs: 2400,
    },
    savedReport: { internalText: `保存 ${XSS}`, customerText: '保存した保護者向け' },
    ...overrides,
  };
}

function result(generationId: string, model: string, overrides: Partial<ComparisonCallResult> = {}) {
  return {
    generationId,
    model,
    run: 1,
    ok: true,
    errorCode: null,
    errorMessage: null,
    latencyMs: 1500,
    draft: { warnings: [], internal: `${model} の社内 ${XSS}`, customer: `${model} の保護者` },
    jsonValid: true,
    shapeIssues: [],
    usage: { promptTokens: 100, candidatesTokens: 50, thoughtsTokens: 0, totalTokens: 150 },
    usedKeywords: [{ code: 'Z99<i>', keyword: null, status: 'unknown' }],
    ...overrides,
  } satisfies ComparisonCallResult;
}

function report(overrides: Partial<AiCompareReport> = {}): AiCompareReport {
  return {
    tenantSlug: 'review',
    generatedAt: new Date('2026-10-01T00:00:00Z'),
    timeZone: 'Asia/Tokyo',
    models: ['model-a', 'model-b'],
    runs: 1,
    thinkingBudget: undefined,
    rebuild: false,
    blind: false,
    blindSeed: 'seed-1',
    cases: [testCase('g1')],
    results: [
      result('g1', 'model-a'),
      result('g1', 'model-b', {
        ok: false,
        errorCode: 'api_error',
        errorMessage: `混雑 ${XSS}`,
        draft: null,
        jsonValid: false,
        usage: null,
        usedKeywords: [],
      }),
    ],
    skipped: [{ generationId: 'g9', reason: `理由 ${XSS}` }],
    missingIds: [],
    ...overrides,
  };
}

describe('モデル比較の HTML', () => {
  it('モデル・スタッフの文は全てエスケープし、外部のファイルもスクリプトも読まない', () => {
    const html = renderAiCompareHtml(report());
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).not.toMatch(/\b(src|href)=/);
    expect(html).toContain("default-src 'none'");
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('当時の出力・各モデル・保存した文と、モデルごとのまとめを並べる', () => {
    const html = renderAiCompareHtml(report());
    expect(html).toContain('当時の出力(gemini-flash-latest)');
    expect(html).toContain('スタッフが保存した文');
    expect(html).toContain('model-a の保護者');
    expect(html).toContain('失敗(api_error)');
    expect(html).toContain('トークン: 入力 100 / 出力 50 / 思考 0 / 計 150');
    expect(html).toContain('表に無い');
    // まとめ: model-a は成功1/1、model-b は 0/1
    expect(html).toMatch(/<td>model-a<\/td><td>100%\(1\/1\)<\/td><td>100%\(1\/1\)<\/td><td>1\.5秒<\/td>/);
    expect(html).toMatch(/<td>model-b<\/td><td>0%\(0\/1\)<\/td>/);
    expect(html).toContain('比べなかった生成(1件)');
  });

  it('--blind はモデル名を件ごとに並べ替えた A・B に隠し、対応は末尾の details にだけ書く', () => {
    const cases = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id) => testCase(id));
    const results = cases.flatMap((c) => [
      result(c.generationId, 'model-a'),
      result(c.generationId, 'model-b'),
    ]);
    const html = renderAiCompareHtml(report({ blind: true, cases, results }));
    const [body, mapping] = html.split('<details class="mapping">');
    // 本文(まとめの details の外)には列のモデル名が出ない
    const columns = (body ?? '').replace(/<details><summary>モデルごとのまとめ[\s\S]*?<\/details>/, '');
    expect(columns).not.toContain('<h4>model-a');
    expect(columns).not.toContain('gemini-flash-latest');
    expect(columns).toContain('<h4>A</h4>');
    expect(columns).toContain('<h4>B</h4>');
    expect(mapping).toContain('g1: ');
    expect(mapping).toMatch(/A = model-[ab] \/ B = model-[ab]/);
    // 同じ種なら同じ並び、件ごとに並びが変わる
    const first = cases.map((c) =>
      blindLabelsOf(['model-a', 'model-b'], 'seed-1', c.generationId).get('model-a'),
    );
    const again = cases.map((c) =>
      blindLabelsOf(['model-a', 'model-b'], 'seed-1', c.generationId).get('model-a'),
    );
    expect(again).toEqual(first);
    expect(new Set(first)).toEqual(new Set(['A', 'B']));
    expect(seededShuffle([1, 2, 3, 4], 's', 'k')).toEqual(seededShuffle([1, 2, 3, 4], 's', 'k'));
    expect([...seededShuffle([1, 2, 3, 4], 's', 'k')].sort()).toEqual([1, 2, 3, 4]);
  });

  it('何回も送ったときは列に何回目かを付ける', () => {
    const html = renderAiCompareHtml(
      report({
        models: ['model-a'],
        runs: 2,
        results: [result('g1', 'model-a'), result('g1', 'model-a', { run: 2 })],
      }),
    );
    expect(html).toContain('<h4>model-a・1回目</h4>');
    expect(html).toContain('<h4>model-a・2回目</h4>');
  });
});
