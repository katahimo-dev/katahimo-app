import { AI_PROMPT_KEYS, findAiPromptDefinition } from '@katahimo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ESCALATION_WARNING } from '../domain';
import type { DailyReportDraft, ReportAiPort } from '../ports/ai';
import { reportAiFixtureMasters } from '../testSupport/reportAiFixtures';
import { generateAccidentReportDraft, generateDailyReportDraft, type ReportAiDeps } from './reportAi';
import type { Actor } from './requestMeta';
import { createTestContext, type TestContext } from './testContext';

/** 送られたプロンプトを覚え、決めた答えを返す AI。 */
function fakeAi(answer: DailyReportDraft = { warnings: [], internal: '社内', customer: '保護者' }) {
  const prompts: string[] = [];
  const port: ReportAiPort = {
    reportModel: 'test-model',
    async generateDailyReport({ prompt }) {
      prompts.push(prompt);
      return structuredClone(answer);
    },
    async generateAccidentReport({ prompt }) {
      prompts.push(prompt);
      return { error: 'unused' };
    },
    async extractReceiptAmount() {
      return { amount: '', storeName: '', receiptDate: '' };
    },
  };
  return { port, prompts };
}

/** テナントのマスターを入れる(架空の中身)。 */
async function seedMasters(ctx: TestContext, staffId: string) {
  const masters = reportAiFixtureMasters();
  await ctx.uow.run(ctx.tenantId, async (r) => {
    for (const { id, ...k } of masters.keywords) await r.reportAi.insertRow('keywords', id, k, staffId);
    for (const { id, ...b } of masters.ageBands) await r.reportAi.insertRow('ageBands', id, b, staffId);
    for (const { id, ...p } of masters.phrases) await r.reportAi.insertRow('phrases', id, p, staffId);
    for (const { id, ...s } of masters.stanceRules) await r.reportAi.insertRow('stanceRules', id, s, staffId);
    for (const l of masters.educationLevels)
      await r.reportAi.upsertLevel('educationLevels', `lvl-${l.level}`, l, staffId);
  });
}

describe('保育日報の AI 生成(日報AIの3軸と生成の記録)', () => {
  let ctx: TestContext;
  let staff: Actor;
  let customerId: string;
  let recipientId: string;
  let ai: ReturnType<typeof fakeAi>;
  let deps: ReportAiDeps;

  beforeEach(async () => {
    ctx = createTestContext({ now: '2026-09-25T03:00:00Z' });
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    customerId = await ctx.addCustomer('佐藤 花子', 'C1', [{ name: 'はな', birthDate: '2025-07-10' }]);
    recipientId = ctx.data().recipients[0]?.id as string;
    ai = fakeAi({
      warnings: [],
      internal: '社内',
      customer: '保護者',
      usedKeywords: ['K04 指先の語', 'K02 協力の語', 'Z99 なぞ'],
    });
    deps = {
      uow: ctx.uow,
      appLog: ctx.appLog,
      secretBox: ctx.secretBox,
      reportAi: ai.port,
      reportAiFactory: { create: () => ai.port },
      appVersion: 'rev-1',
      now: ctx.deps.now,
    };
  });

  it('マスターが空なら既定の文面で組み立て、生成を記録する(既定の文面は版の代わりに SHA-256)', async () => {
    const result = await generateDailyReportDraft(deps, staff, {
      text: 'メモ',
      start: '09:00',
      end: '12:00',
      customerId,
      careRecipientId: null,
    });
    expect(ai.prompts[0]).toContain('* 保育時間: 09:00〜12:00');
    expect(ai.prompts[0]).not.toContain('【日報キーワード表】');
    const [generation] = ctx.data().reportAiGenerations;
    expect(generation).toMatchObject({
      id: result.ai.generationId,
      staffId: staff.staffId,
      customerId,
      careRecipientId: null,
      promptKey: AI_PROMPT_KEYS.DAILY_REPORT_GENERATE,
      promptRevision: null,
      appVersion: 'rev-1',
      model: 'test-model',
      inputText: 'メモ',
      timeInfo: '09:00〜12:00',
      educationLevel: 2,
      effectiveEducationLevel: 2,
      riskRating: null,
      escalationRequired: false,
      candidateKeywordIds: [],
      errorCode: null,
    });
    expect(generation?.defaultPromptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(generation?.promptText).toBe(ai.prompts[0]);
    // プロンプト・メモは操作ログに書かない
    expect(JSON.stringify(ctx.data().appLogs)).not.toContain('メモ');
  });

  it('対象のお子様の月齢(訪問日の時点)・家庭の★・PSI で候補を絞り、使った語を候補の行に直す', async () => {
    await seedMasters(ctx, staff.staffId);
    await ctx.uow.run(ctx.tenantId, (r) =>
      r.customerReportProfiles.save(customerId, 5, staff.staffId, undefined),
    );
    const result = await generateDailyReportDraft(deps, staff, {
      text: 'メモ',
      customerId,
      careRecipientId: recipientId,
      riskRating: 4,
      reportDate: '2026-09-20',
    });
    expect(result.ai).toMatchObject({
      childAgeMonths: 14,
      educationLevel: 5,
      effectiveEducationLevel: 5,
      candidateCount: 3,
      escalationRequired: false,
      usedKeywords: [
        { code: 'K04', keyword: '指先の語', status: 'used' },
        // 表にはあるが月齢の外で候補に見せていない語は、使った語に数えない
        { code: 'K02', keyword: '協力の語', status: 'not_offered' },
        { code: 'Z99 なぞ', keyword: null, status: 'unknown' },
      ],
    });
    expect(ai.prompts[0]).toContain('【年齢帯：1歳（月齢12〜24か月）】');
    const [generation] = ctx.data().reportAiGenerations;
    expect(generation?.candidateKeywordIds).toHaveLength(3);
    expect(generation?.usedKeywordIds).toEqual(['00000000-0000-7000-8000-00000000a004']);
    expect(generation?.unresolvedUsedCodes).toEqual(['K02 協力の語', 'Z99 なぞ']);
    expect(generation?.careRecipientId).toBe(recipientId);
  });

  it('家庭の★を未設定に戻した(null の行)家庭は、行の無い家庭と同じく★2 で組み立てる', async () => {
    await seedMasters(ctx, staff.staffId);
    const input = { text: 'メモ', customerId, careRecipientId: recipientId, reportDate: '2026-09-20' };
    await generateDailyReportDraft(deps, staff, input);
    await ctx.uow.run(ctx.tenantId, async (r) => {
      await r.customerReportProfiles.save(customerId, 5, staff.staffId, undefined);
      await r.customerReportProfiles.save(customerId, null, staff.staffId, 1);
    });
    const result = await generateDailyReportDraft(deps, staff, input);
    expect(result.ai).toMatchObject({ educationLevel: 2 });
    expect(ai.prompts[1]).toBe(ai.prompts[0]);
  });

  it('PSI 1 は AI が書かなくても warnings に「管理者へ連絡」を入れ、記録にも残す', async () => {
    const result = await generateDailyReportDraft(deps, staff, { text: 'メモ', customerId, riskRating: 1 });
    expect(result.draft.warnings).toEqual([ESCALATION_WARNING]);
    expect(result.ai.escalationRequired).toBe(true);
    expect(result.ai.effectiveEducationLevel).toBeNull();
    expect(ctx.data().reportAiGenerations[0]).toMatchObject({ riskRating: 1, escalationRequired: true });
  });

  it('テナントが上書きしたプロンプトはその版を記録する', async () => {
    await ctx.uow.run(ctx.tenantId, (r) =>
      r.aiPrompts.save({
        key: AI_PROMPT_KEYS.DAILY_REPORT_GENERATE,
        kind: 'prompt',
        body: '独自 {anonymizedText} / {anonymizedText} / {psi}',
        updatedBy: staff.staffId,
      }),
    );
    await generateDailyReportDraft(deps, staff, { text: 'メモ', customerId, riskRating: 3 });
    expect(ai.prompts[0]).toBe('独自 メモ / メモ / 3（要観察）');
    expect(ctx.data().reportAiGenerations[0]).toMatchObject({ promptRevision: 1, defaultPromptSha256: null });
  });

  it('API キーが無いときは同じ形で返し、失敗の種類を記録する', async () => {
    ai = fakeAi({ warnings: ['API Key Missing'], internal: 'Error: API Key not set', customer: '' });
    deps = { ...deps, reportAi: ai.port };
    const result = await generateDailyReportDraft(deps, staff, { text: 'メモ', customerId, riskRating: 1 });
    expect(result.draft.warnings).toEqual(['API Key Missing']);
    expect(ctx.data().reportAiGenerations[0]).toMatchObject({ output: null, errorCode: 'api_key_missing' });
    expect(ctx.appLog.actions()).toContain('ai.daily_report.generate_failed');
  });

  it('対象のお子様を省略すると世帯の子が1人ならその子の月齢で絞る(null は選ばない)', async () => {
    await seedMasters(ctx, staff.staffId);
    const auto = await generateDailyReportDraft(deps, staff, {
      text: 'メモ',
      customerId,
      reportDate: '2026-09-20',
    });
    expect(auto.ai.childAgeMonths).toBe(14);
    expect(ctx.data().reportAiGenerations[0]?.careRecipientId).toBe(recipientId);
    const none = await generateDailyReportDraft(deps, staff, {
      text: 'メモ',
      customerId,
      careRecipientId: null,
      reportDate: '2026-09-20',
    });
    expect(none.ai.childAgeMonths).toBeNull();
    expect(ctx.data().reportAiGenerations[1]?.careRecipientId).toBeNull();
  });

  it('別の世帯の子を指定すると生成の前に 400(AI を呼ばない)', async () => {
    const other = await ctx.addCustomer('田中 一郎', 'C2', [{ name: 'たろう', birthDate: '2024-01-01' }]);
    const otherChild = ctx.data().recipients.find((c) => c.customerId === other)?.id;
    await expect(
      generateDailyReportDraft(deps, staff, { text: 'メモ', customerId, careRecipientId: otherChild }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'care_recipient_mismatch' });
    expect(ai.prompts).toEqual([]);
  });

  it('生成の記録に失敗しても生成の結果は返す(記録の ID は null)', async () => {
    // AI を呼んだあと(記録の書き込み)の DB だけ失敗させる
    const generate = ai.port.generateDailyReport.bind(ai.port);
    ai.port.generateDailyReport = async (input) => {
      const answer = await generate(input);
      ctx.uow.run = async () => {
        throw new Error('db down');
      };
      return answer;
    };
    const result = await generateDailyReportDraft(deps, staff, { text: 'メモ', customerId });
    expect(result.draft.customer).toBe('保護者');
    expect(result.ai.generationId).toBeNull();
    expect(ctx.appLog.actions()).toContain('ai.daily_report.generation_log_failed');
  });

  it('事故報告は入力メモと時間情報(開始だけでも)を全ての箇所に差し込む', async () => {
    await ctx.uow.run(ctx.tenantId, (r) =>
      r.aiPrompts.save({
        key: AI_PROMPT_KEYS.ACCIDENT_REPORT_GENERATE,
        kind: 'prompt',
        body: '{anonymizedText}|{timeInfo}|{timeInfo}',
        updatedBy: staff.staffId,
      }),
    );
    await generateAccidentReportDraft(deps, staff, { text: 'ころんだ', start: '10:00' });
    expect(ai.prompts[0]).toBe('ころんだ|10:00|10:00');
    expect(findAiPromptDefinition(AI_PROMPT_KEYS.ACCIDENT_REPORT_GENERATE)?.defaultBody).toContain(
      '{timeInfo}',
    );
  });
});
