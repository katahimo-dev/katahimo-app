import type { DailyReportDraft, ReportAiPort } from '@katahimo/core/ports';
import { createTestContext, type TestContext } from '@katahimo/core/test-utils';
import { generateDailyReportDraft } from '@katahimo/core/usecases';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AiCompareArgs, parseAiCompareArgs } from './args';
import { type AiCompareCommandDeps, runAiCompareCommand } from './command';

function fakeAi(answer: DailyReportDraft, hasApiKey = true) {
  const models: (string | undefined)[] = [];
  const port: ReportAiPort = {
    hasApiKey,
    async generateDailyReport({ model }) {
      models.push(model);
      return structuredClone(answer);
    },
    async generateAccidentReport() {
      return { error: 'unused' };
    },
    async extractReceiptAmount() {
      return { amount: '', storeName: '', receiptDate: '' };
    },
  };
  return { port, models };
}

function argsOf(...args: string[]): AiCompareArgs {
  const parsed = parseAiCompareArgs(['node', 'aiCompare.ts', ...args]);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

describe('pnpm ai:compare の流れ', () => {
  let ctx: TestContext;
  let ai: ReturnType<typeof fakeAi>;
  let files: Map<string, string>;
  let lines: string[];
  let deps: AiCompareCommandDeps;

  beforeEach(async () => {
    ctx = createTestContext({ now: '2026-09-25T03:00:00Z' });
    const staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    const customerId = await ctx.addCustomer('佐藤 花子', 'C1', []);
    ai = fakeAi({ warnings: [], internal: '社内の文', customer: '保護者の文' });
    await generateDailyReportDraft(
      {
        uow: ctx.uow,
        appLog: ctx.appLog,
        secretBox: ctx.secretBox,
        reportAi: ai.port,
        reportAiFactory: { create: () => ai.port },
        now: ctx.deps.now,
      },
      staff,
      { text: '架空のメモ', customerId },
    );
    ai.models.length = 0;
    files = new Map();
    lines = [];
    deps = {
      allowList: 'test-tenant',
      tenants: ctx.deps.tenants,
      uow: ctx.uow,
      appLog: ctx.appLog,
      resolveReportAi: async () => ai.port,
      resolvePath: (path) => `/out/${path}`,
      writeFile: async (path, content) => {
        files.set(path, content);
      },
      now: () => new Date('2026-10-01T01:02:00Z'),
      blindSeed: () => 'seed',
      log: (line) => lines.push(line),
      warn: (line) => lines.push(line),
    };
  });

  it('AI_COMPARE_TENANTS に無いテナントは DB を読まずに断る', async () => {
    const outcome = await runAiCompareCommand(
      { ...deps, allowList: 'review' },
      argsOf('test-tenant', '--models', 'a'),
    );
    expect(outcome).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('AI_COMPARE_TENANTS'),
    });
    expect(ai.models).toEqual([]);
    expect(files.size).toBe(0);
  });

  it('知らないテナント・見つからない生成は1回も呼ばずに断る', async () => {
    const unknown = await runAiCompareCommand(
      { ...deps, allowList: 'nope' },
      argsOf('nope', '--models', 'a'),
    );
    expect(unknown).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('テナントが見つかりません'),
    });
    const missing = await runAiCompareCommand(
      deps,
      argsOf('test-tenant', '--models', 'a', '--generation', '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'),
    );
    expect(missing).toMatchObject({ status: 'refused', message: expect.stringContaining('見つかりません') });
    expect(ai.models).toEqual([]);
  });

  it('呼ぶ回数が上限を超えるなら1回も呼ばずに断る', async () => {
    // 1件 × 4モデル × 3回 = 12回は上限内。件数を増やして超えさせる
    const base = ctx.data().reportAiGenerations[0];
    if (!base) throw new Error('生成の記録がありません');
    for (let i = 0; i < 20; i++) {
      ctx.data().reportAiGenerations.push({
        ...structuredClone(base),
        id: `0190a1b2-c3d4-7e5f-8a9b-${String(i).padStart(12, '0')}`,
      });
    }
    const outcome = await runAiCompareCommand(
      deps,
      argsOf('test-tenant', '--models', 'a,b,c,d', '--runs', '3', '--latest', '21'),
    );
    expect(outcome).toMatchObject({ status: 'refused', message: expect.stringContaining('上限') });
    expect(ai.models).toEqual([]);
  });

  it('--dry-run は計画を出すだけで、Gemini を呼ばず、ファイルも操作ログも書かない', async () => {
    const logsBefore = ctx.appLog.actions().length;
    const outcome = await runAiCompareCommand(
      deps,
      argsOf('test-tenant', '--models', 'a,b', '--runs', '2', '--dry-run'),
    );
    expect(outcome).toEqual({ status: 'planned', calls: 4 });
    expect(lines.join('\n')).toContain('対象 1件 × モデル 2つ(a, b) × 2回 = Gemini を 4回呼びます');
    expect(ai.models).toEqual([]);
    expect(files.size).toBe(0);
    expect(ctx.appLog.actions().length).toBe(logsBefore);
  });

  it('呼んだ結果を HTML に書き、操作ログには件数・モデル・ID だけを残す', async () => {
    const outcome = await runAiCompareCommand(deps, argsOf('test-tenant', '--models', 'a,b'));
    expect(outcome).toMatchObject({
      status: 'completed',
      path: '/out/ai-compare-test-tenant-202610011002.html',
      calls: 2,
      failures: 0,
    });
    expect(ai.models).toEqual(['a', 'b']);
    const html = files.get('/out/ai-compare-test-tenant-202610011002.html') ?? '';
    expect(html).toContain('架空のメモ');
    expect(html).toContain('保護者の文');
    const log = ctx.data().appLogs.find((l) => l.action === 'ai.compare.completed');
    expect(log).toMatchObject({ level: 'INFO', details: { models: ['a', 'b'], calls: 2, failures: 0 } });
    expect(JSON.stringify(ctx.data().appLogs)).not.toContain('架空のメモ');
    expect(JSON.stringify(log)).not.toContain('社内の文');
    expect(lines.join('\n')).toContain('テナントのデータ');
  });

  it('API キーが無ければ呼び出しごとの失敗として HTML に残し、WARN にする', async () => {
    const noKey = fakeAi(
      { warnings: ['API Key Missing'], internal: 'Error: API Key not set', customer: '' },
      false,
    );
    const outcome = await runAiCompareCommand(
      { ...deps, resolveReportAi: async () => noKey.port },
      argsOf('test-tenant', '--models', 'a', '--out', 'x.html'),
    );
    expect(outcome).toMatchObject({ status: 'completed', path: '/out/x.html', failures: 1 });
    expect(files.get('/out/x.html')).toContain('失敗(api_key_missing): Error: API Key not set');
    expect(ctx.data().appLogs.find((l) => l.action === 'ai.compare.completed')).toMatchObject({
      level: 'WARN',
    });
    expect(lines.join('\n')).toContain('API キーがありません');
  });
});
