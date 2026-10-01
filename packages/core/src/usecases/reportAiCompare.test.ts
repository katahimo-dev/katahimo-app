import { AI_PROMPT_KEYS } from '@katahimo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ESCALATION_WARNING } from '../domain';
import type { DailyReportDraft, GenerateDailyReportInput, ReportAiPort } from '../ports/ai';
import { reportAiFixtureMasters } from '../testSupport/reportAiFixtures';
import { generateDailyReportDraft, type ReportAiDeps } from './reportAi';
import {
  AI_COMPARE_LIMITS,
  checkCallBudget,
  comparisonCallResultOf,
  loadReportAiComparisonCases,
  runReportAiComparison,
  safeErrorMessage,
  summarizeReportAiComparison,
} from './reportAiCompare';
import type { Actor } from './requestMeta';
import { createTestContext, type TestContext } from './testContext';

/** 呼ばれた入力を覚え、モデルごとに決めた答えを返す AI。 */
function fakeAi(answers: (input: GenerateDailyReportInput) => DailyReportDraft) {
  const calls: GenerateDailyReportInput[] = [];
  const port: ReportAiPort = {
    hasApiKey: true,
    async generateDailyReport(input) {
      calls.push(input);
      return structuredClone(answers(input));
    },
    async generateAccidentReport() {
      return { error: 'unused' };
    },
    async extractReceiptAmount() {
      return { amount: '', storeName: '', receiptDate: '' };
    },
  };
  return { port, calls };
}

async function seedMasters(ctx: TestContext, staffId: string) {
  const masters = reportAiFixtureMasters();
  await ctx.uow.run(ctx.tenantId, async (r) => {
    for (const { id, ...k } of masters.keywords) await r.reportAi.insertRow('keywords', id, k, staffId);
    for (const { id, ...b } of masters.ageBands) await r.reportAi.insertRow('ageBands', id, b, staffId);
    for (const l of masters.educationLevels)
      await r.reportAi.upsertLevel('educationLevels', `lvl-${l.level}`, l, staffId);
  });
}

describe('運用のモデル比較(reportAiCompare)', () => {
  let ctx: TestContext;
  let staff: Actor;
  let customerId: string;
  let recipientId: string;
  let deps: ReportAiDeps;

  beforeEach(async () => {
    ctx = createTestContext({ now: '2026-09-25T03:00:00Z' });
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    customerId = await ctx.addCustomer('佐藤 花子', 'C1', [{ name: 'はな', birthDate: '2025-07-10' }]);
    recipientId = ctx.data().recipients[0]?.id as string;
    await seedMasters(ctx, staff.staffId);
    const original = fakeAi(() => ({
      warnings: [],
      internal: '当時の社内',
      customer: '当時の保護者',
      usedKeywords: ['K04'],
      diagnostics: { shapeIssues: [], usage: { promptTokens: 10 } },
    }));
    deps = {
      uow: ctx.uow,
      appLog: ctx.appLog,
      secretBox: ctx.secretBox,
      reportAi: original.port,
      reportAiFactory: { create: () => original.port },
      now: ctx.deps.now,
    };
  });

  async function generate(input: { riskRating?: number; text?: string } = {}) {
    const result = await generateDailyReportDraft(deps, staff, {
      text: input.text ?? 'メモ',
      customerId,
      careRecipientId: recipientId,
      reportDate: '2026-09-20',
      ...(input.riskRating !== undefined ? { riskRating: input.riskRating } : {}),
    });
    return result.ai.generationId as string;
  }

  it('生成の記録には検証用の付帯情報(トークン数など)を載せない', async () => {
    await generate();
    const [generation] = ctx.data().reportAiGenerations;
    expect(generation?.output).toEqual({
      warnings: [],
      internal: '当時の社内',
      customer: '当時の保護者',
      usedKeywords: ['K04'],
    });
  });

  it('既定は記録のプロンプトのまま、当時の候補・答え・保存した日報の文を読む(失敗した生成は latest に入らない)', async () => {
    const first = await generate({ text: '一つ目' });
    ctx.clock.now = new Date('2026-09-25T04:00:00Z');
    const second = await generate({ text: '二つ目' });
    const base = ctx.data().reportAiGenerations[0];
    if (!base) throw new Error('生成の記録がありません');
    ctx.data().reportAiGenerations.push({
      ...structuredClone(base),
      id: '00000000-0000-7000-8000-0000000000f1',
      output: null,
      errorCode: 'api_error',
      createdAt: new Date('2026-09-25T05:00:00Z'),
    });
    const stored = ctx.data().reportAiGenerations.find((g) => g.id === second);
    // 1つ目は日報に結び付ける(スタッフが保存した文を参考の列に出す)
    await ctx.uow.run(ctx.tenantId, async (r) => {
      const record = await r.careRecords.insert({
        id: '00000000-0000-7000-8000-0000000000c1',
        recordType: 'daily_report',
        status: 'submitted',
        visitId: null,
        customerId,
        careRecipientId: recipientId,
        authorStaffId: staff.staffId,
        occurredAt: new Date('2026-09-20T01:00:00Z'),
        servicePeriod: null,
        riskRating: null,
        esRating: null,
        body: {
          startTime: '',
          endTime: '',
          inputText: '一つ目',
          internalText: '保存した社内',
          customerText: '保存した保護者',
        },
        bodySchemaVer: 1,
        retainUntil: null,
      });
      await r.reportAiGenerations.linkToCareRecord(first, record.id);
    });
    const loaded = await loadReportAiComparisonCases(ctx, ctx.tenantId, { latest: 10, rebuild: false });
    expect(loaded.cases.map((c) => c.generationId)).toEqual([second, first]);
    const [latest] = loaded.cases;
    expect(latest).toMatchObject({
      prompt: stored?.promptText,
      promptSource: 'original',
      inputText: '二つ目',
      businessDate: '2026-09-25',
      childAgeMonths: 14,
      rebuilt: null,
      savedReport: null,
      original: {
        model: 'gemini-flash-latest',
        draft: { internal: '当時の社内', customer: '当時の保護者' },
        usedKeywords: [{ code: 'K04', status: 'used' }],
      },
    });
    expect(latest?.candidates.map((k) => k.id)).toEqual(stored?.candidateKeywordIds);
    expect(latest?.candidates.length).toBeGreaterThan(0);
    expect(loaded.cases[1]?.savedReport).toEqual({
      internalText: '保存した社内',
      customerText: '保存した保護者',
    });
    // ID を指定すれば失敗した生成も読める。無い ID は missingIds
    const byIds = await loadReportAiComparisonCases(ctx, ctx.tenantId, {
      ids: ['00000000-0000-7000-8000-0000000000f1', '00000000-0000-7000-8000-0000000000f2'],
      latest: 10,
      rebuild: false,
    });
    expect(byIds.cases.map((c) => c.original.errorCode)).toEqual(['api_error']);
    expect(byIds.missingIds).toEqual(['00000000-0000-7000-8000-0000000000f2']);
    // since はテナントの業務日の0時から
    const since = await loadReportAiComparisonCases(ctx, ctx.tenantId, {
      latest: 10,
      since: '2026-09-26',
      rebuild: false,
    });
    expect(since.cases).toEqual([]);
  });

  it('rebuild は今のプロンプト・家庭の★で組み立て直し、お客様が無ければ飛ばす', async () => {
    const id = await generate();
    await ctx.uow.run(ctx.tenantId, async (r) => {
      await r.aiPrompts.save({
        key: AI_PROMPT_KEYS.DAILY_REPORT_GENERATE,
        kind: 'prompt',
        body: '今の文面 {anonymizedText} {eduLevel}',
        updatedBy: staff.staffId,
      });
      await r.customerReportProfiles.save(customerId, 5, staff.staffId, undefined);
    });
    const loaded = await loadReportAiComparisonCases(ctx, ctx.tenantId, {
      ids: [id],
      latest: 10,
      rebuild: true,
    });
    expect(loaded.cases[0]).toMatchObject({
      promptSource: 'rebuilt',
      prompt: expect.stringMatching(/^今の文面 メモ 5/),
      educationLevel: 2,
      rebuilt: { educationLevel: 5, childAgeMonths: 14 },
    });
    // 記録のお客様がもう無い
    const generation = ctx.data().reportAiGenerations.find((g) => g.id === id);
    if (generation) generation.customerId = '00000000-0000-7000-8000-0000000000aa';
    const skipped = await loadReportAiComparisonCases(ctx, ctx.tenantId, {
      ids: [id],
      latest: 10,
      rebuild: true,
    });
    expect(skipped.cases).toEqual([]);
    expect(skipped.skipped).toEqual([
      { generationId: id, reason: expect.stringContaining('customer_not_found') },
    ]);
  });

  it('生成 × モデル × 回数を順に呼び、思考の量を渡し、使った語・形・トークン数・失敗をまとめる', async () => {
    await generate({ riskRating: 1 });
    const loaded = await loadReportAiComparisonCases(ctx, ctx.tenantId, { latest: 10, rebuild: false });
    const ai = fakeAi((input) =>
      input.model === 'model-b'
        ? {
            warnings: ['API Error'],
            internal: '混み合っています\n\n[詳細] {"secret":"x"}',
            customer: '',
            retryable: true,
          }
        : {
            warnings: [],
            internal: '<script>社内</script>',
            customer: '保護者',
            usedKeywords: ['K04', 'K02', 'Z99'],
            diagnostics: {
              shapeIssues: input.model === 'model-c' ? ['missing:customer'] : [],
              usage: { promptTokens: 100, candidatesTokens: 50, thoughtsTokens: 20, totalTokens: 170 },
            },
          },
    );
    let clock = 0;
    const progress: number[] = [];
    const results = await runReportAiComparison(
      {
        reportAi: ai.port,
        now: () => {
          clock += 500;
          return clock;
        },
        onProgress: (done) => progress.push(done),
      },
      loaded,
      { models: ['model-a', 'model-b', 'model-c'], runs: 2, thinkingBudget: 0 },
    );
    expect(ai.calls).toHaveLength(6);
    expect(ai.calls.every((c) => c.thinkingBudget === 0 && c.prompt === loaded.cases[0]?.prompt)).toBe(true);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6]);
    const a = results.find((r) => r.model === 'model-a');
    expect(a).toMatchObject({
      ok: true,
      jsonValid: true,
      latencyMs: 500,
      // PSI 1 は画面と同じく「管理者へ連絡」を入れる
      draft: { warnings: [ESCALATION_WARNING] },
    });
    expect(a?.usedKeywords.map((k) => k.status)).toEqual(['not_offered', 'not_offered', 'unknown']);
    const b = results.find((r) => r.model === 'model-b');
    expect(b).toMatchObject({
      ok: false,
      errorCode: 'api_error',
      errorMessage: '混み合っています',
      draft: null,
    });
    expect(JSON.stringify(results)).not.toContain('secret');

    const summary = summarizeReportAiComparison(['model-a', 'model-b', 'model-c'], results);
    expect(summary).toEqual([
      expect.objectContaining({
        model: 'model-a',
        calls: 2,
        successes: 2,
        jsonValid: 2,
        avgLatencyMs: 500,
        avgPromptTokens: 100,
        avgThoughtsTokens: 20,
        notOffered: 4,
        unknown: 2,
      }),
      expect.objectContaining({
        model: 'model-b',
        calls: 2,
        successes: 0,
        jsonValid: 0,
        avgLatencyMs: null,
        avgPromptTokens: null,
      }),
      expect.objectContaining({ model: 'model-c', successes: 2, jsonValid: 0 }),
    ]);
  });

  it('呼ぶ回数が上限を超えるなら1回も呼ばずに止める', async () => {
    expect(checkCallBudget(50, { models: ['a', 'b', 'c', 'd'], runs: 1 })).toBeNull();
    expect(checkCallBudget(50, { models: ['a', 'b', 'c', 'd'], runs: 2 })).toContain(
      `400回 > ${AI_COMPARE_LIMITS.maxCalls}回`,
    );
    await generate();
    const loaded = await loadReportAiComparisonCases(ctx, ctx.tenantId, { latest: 10, rebuild: false });
    const ai = fakeAi(() => ({ warnings: [], internal: '', customer: '' }));
    const many = { ...loaded, cases: Array.from({ length: 70 }, () => loaded.cases[0] as never) };
    await expect(
      runReportAiComparison({ reportAi: ai.port }, many, { models: ['a', 'b', 'c'], runs: 1 }),
    ).rejects.toThrow('上限');
    expect(ai.calls).toHaveLength(0);
  });

  it('API キーが無い呼び出しは失敗として残し、応答の本文は載せない', () => {
    expect(safeErrorMessage('Error: API Key not set')).toBe('Error: API Key not set');
    expect(safeErrorMessage('レート制限\n\n[詳細] {"error":"..."}')).toBe('レート制限');
    const testCase = {
      generationId: 'g',
      candidates: [],
      escalationRequired: false,
      rebuilt: null,
    } as never;
    const result = comparisonCallResultOf(testCase, [], {
      model: 'm',
      run: 1,
      latencyMs: 3,
      raw: { warnings: ['API Key Missing'], internal: 'Error: API Key not set', customer: '' },
    });
    expect(result).toMatchObject({ ok: false, errorCode: 'api_key_missing', jsonValid: false, usage: null });
  });
});
