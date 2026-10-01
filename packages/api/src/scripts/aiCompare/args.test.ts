import { describe, expect, it } from 'vitest';
import { checkAiCompareTenant, parseAiCompareArgs } from './args';

const argv = (...args: string[]) => ['node', 'aiCompare.ts', ...args];
const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('pnpm ai:compare の引数', () => {
  it('pnpm の `--` を落とし、既定(最新10件・1回・当時のプロンプト)で読む', () => {
    const parsed = parseAiCompareArgs(
      argv('--', 'review', '--models', 'gemini-2.5-flash, gemini-2.5-flash-lite'),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        slug: 'review',
        models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
        generationIds: [],
        latest: 10,
        since: undefined,
        runs: 1,
        rebuild: false,
        thinkingBudget: undefined,
        blind: false,
        out: undefined,
        dryRun: false,
      },
    });
  });

  it('全てのオプションを読み、--generation は何回でも指定できる(重なりは1つ)', () => {
    const parsed = parseAiCompareArgs(
      argv(
        'review',
        '--models',
        'a,b',
        '--generation',
        ID,
        '--generation',
        ID.toUpperCase(),
        '--runs',
        '3',
        '--rebuild',
        '--thinking-budget',
        '0',
        '--blind',
        '--out',
        'x.html',
        '--dry-run',
      ),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        generationIds: [ID],
        runs: 3,
        rebuild: true,
        thinkingBudget: 0,
        blind: true,
        out: 'x.html',
        dryRun: true,
      },
    });
  });

  it.each([
    [['--models', 'a'], 'slug'],
    [['review'], '--models'],
    [['review', '--models', 'a,b,c,d,e'], '最大4つ'],
    [['review', '--models', 'a,a'], '同じモデル'],
    [['review', '--models', 'a/../b'], 'モデル名'],
    [['review', '--models', 'a', '--latest', '51'], '--latest'],
    [['review', '--models', 'a', '--latest', '0'], '--latest'],
    [['review', '--models', 'a', '--runs', '4'], '--runs'],
    [['review', '--models', 'a', '--since', '2026-02-30'], '--since'],
    [['review', '--models', 'a', '--thinking-budget', 'x'], '--thinking-budget'],
    [['review', '--models', 'a', '--generation', 'nope'], 'UUID'],
    [['review', '--models', 'a', '--generation', ID, '--latest', '3'], '一緒に使えません'],
    [['review', '--models', 'a', '--force'], '知らない引数'],
  ])('%j は断る', (args, message) => {
    const parsed = parseAiCompareArgs(argv(...args));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain(message);
  });

  it('AI_COMPARE_TENANTS に書いたテナントだけを比べる(未設定は全て断る)', () => {
    expect(checkAiCompareTenant('review', 'review, other')).toBeNull();
    expect(checkAiCompareTenant('customer-a', 'review')).toContain('AI_COMPARE_TENANTS に無い');
    expect(checkAiCompareTenant('review', undefined)).toContain('設定されていません');
    expect(checkAiCompareTenant('review', ' , ')).toContain('設定されていません');
  });
});
