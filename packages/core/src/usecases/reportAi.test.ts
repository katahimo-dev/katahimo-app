import { AI_PROMPT_KEYS, findAiPromptDefinition } from '@katahimo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { ESCALATION_WARNING } from '../domain';
import type { DailyReportDraft, ReceiptOcrResult, ReportAiPort } from '../ports/ai';
import { reportAiFixtureMasters } from '../testSupport/reportAiFixtures';
import {
  extractReceiptAmount,
  generateAccidentReportDraft,
  generateDailyReportDraft,
  listReportModels,
  type ReportAiDeps,
} from './reportAi';
import type { Actor } from './requestMeta';
import { createTestContext, type TestContext } from './testContext';

/** 送られたプロンプトを覚え、決めた答えを返す AI。 */
function fakeAi(answer: DailyReportDraft = { warnings: [], internal: '社内', customer: '保護者' }) {
  const prompts: string[] = [];
  const models: (string | undefined)[] = [];
  const port: ReportAiPort = {
    hasApiKey: true,
    async generateDailyReport({ prompt, model }) {
      prompts.push(prompt);
      models.push(model);
      return structuredClone(answer);
    },
    async generateAccidentReport({ prompt, model }) {
      prompts.push(prompt);
      models.push(model);
      return { error: 'unused' };
    },
    async extractReceiptAmount() {
      return { amount: '', storeName: '', receiptDate: '' };
    },
  };
  return { port, prompts, models };
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
      model: 'gemini-flash-latest',
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

  it('試すモデルの順番は Flash 系 → Flash-Lite 系で -latest が先頭(使えるモデルの一覧から。読めなければ既知の名前)', async () => {
    ai.port.availableModels = async () => [
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash-preview-tts',
    ];
    expect(await listReportModels(deps, staff)).toEqual([
      'gemini-flash-latest',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-flash-lite',
    ]);
    ai.port.availableModels = async () => null;
    expect((await listReportModels(deps, staff)).slice(0, 2)).toEqual([
      'gemini-flash-latest',
      'gemini-2.5-flash',
    ]);
  });

  it('モデルを指定しなければ順番の先頭で書く(設定のモデルは無い)', async () => {
    ai.port.availableModels = async () => ['gemini-2.5-flash', 'gemini-2.0-flash'];
    const result = await generateDailyReportDraft(deps, staff, { text: 'メモ', customerId });
    expect(ai.models).toEqual(['gemini-2.5-flash']);
    expect(result.ai.model).toBe('gemini-2.5-flash');
    expect(ctx.appLog.actions()).not.toContain('ai.daily_report.model_fallback_succeeded');
  });

  it('API キーが無ければ試すモデルは無く、モデルを指定すると 400(日報・事故報告)', async () => {
    const noop: ReportAiPort = { ...ai.port, hasApiKey: false };
    deps = { ...deps, reportAi: noop, reportAiFactory: { create: () => noop } };
    expect(await listReportModels(deps, staff)).toEqual([]);
    await expect(
      generateDailyReportDraft(deps, staff, { text: 'メモ', customerId, model: 'gemini-2.5-flash' }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'model_not_allowed' });
    await expect(
      generateAccidentReportDraft(deps, staff, { text: 'ころんだ', model: 'gemini-2.5-flash' }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'model_not_allowed' });
    const result = await generateDailyReportDraft(deps, staff, { text: 'メモ', customerId });
    expect(result.ai.model).toBeNull();
    expect(ai.models).toEqual([undefined]);
  });

  it('指定したモデルで呼び、失敗はモデル名つきで残す。Flash / Flash-Lite 系以外は 400(AI を呼ばない)', async () => {
    ai = fakeAi({
      warnings: ['API Error'],
      internal: '混み合っています',
      customer: '',
      retryable: true,
      failure: { reason: 'http_error', httpStatus: 503 },
    });
    deps = { ...deps, reportAi: ai.port, reportAiFactory: { create: () => ai.port } };
    const failed = await generateDailyReportDraft(deps, staff, {
      text: 'メモ',
      customerId,
      model: 'gemini-2.0-flash',
    });
    expect(ai.models).toEqual(['gemini-2.0-flash']);
    expect(failed.ai).toMatchObject({ model: 'gemini-2.0-flash', retryable: true });
    expect(failed.draft).toEqual({ warnings: ['API Error'], internal: '混み合っています', customer: '' });
    expect(ctx.data().reportAiGenerations[0]).toMatchObject({
      model: 'gemini-2.0-flash',
      errorCode: 'api_error',
    });
    // 操作ログには理由コードと HTTP の状態だけ(失敗の文は残さない)。画面への応答に failure は返さない
    expect(ctx.appLog.byAction('ai.daily_report.generate_failed')[0]?.details).toEqual({
      customerId,
      model: 'gemini-2.0-flash',
      fallback: true,
      retryable: true,
      reason: 'http_error',
      httpStatus: 503,
    });

    await expect(
      generateDailyReportDraft(deps, staff, { text: 'メモ', customerId, model: 'gemini-2.5-pro' }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'model_not_allowed' });
    expect(ai.models).toHaveLength(1);
  });

  it('切り替えた先のモデルで書けたら WARN で残す(先頭のモデルで書けたときは残さない)', async () => {
    await generateDailyReportDraft(deps, staff, { text: 'メモ', customerId, model: 'gemini-flash-latest' });
    expect(ctx.appLog.actions()).not.toContain('ai.daily_report.model_fallback_succeeded');
    const result = await generateDailyReportDraft(deps, staff, {
      text: 'メモ',
      customerId,
      model: 'gemini-2.5-flash-lite',
    });
    expect(result.ai).toMatchObject({ model: 'gemini-2.5-flash-lite', retryable: false });
    expect(ctx.appLog.byAction('ai.daily_report.model_fallback_succeeded')[0]).toMatchObject({
      level: 'WARN',
      details: { model: 'gemini-2.5-flash-lite', firstModel: 'gemini-flash-latest' },
    });
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
    const result = await generateAccidentReportDraft(deps, staff, { text: 'ころんだ', start: '10:00' });
    expect(ai.prompts[0]).toBe('ころんだ|10:00|10:00');
    expect(result).toEqual({ draft: { error: 'unused' }, model: 'gemini-flash-latest', retryable: false });
    expect(findAiPromptDefinition(AI_PROMPT_KEYS.ACCIDENT_REPORT_GENERATE)?.defaultBody).toContain(
      '{timeInfo}',
    );
  });

  it('事故報告もモデルを指定して呼び、失敗はモデル名と試し直す意味つきで返し・残す', async () => {
    ai.port.generateAccidentReport = async ({ model }) => {
      ai.models.push(model);
      return model === 'gemini-flash-latest'
        ? { error: '混み合っています', retryable: true }
        : { error: 'APIキーが無効です', retryable: false };
    };
    const first = await generateAccidentReportDraft(deps, staff, { text: 'ころんだ' });
    expect(first).toEqual({
      draft: { error: '混み合っています' },
      model: 'gemini-flash-latest',
      retryable: true,
    });
    const second = await generateAccidentReportDraft(deps, staff, {
      text: 'ころんだ',
      model: 'gemini-2.5-flash',
    });
    expect(second).toMatchObject({ model: 'gemini-2.5-flash', retryable: false });
    expect(ctx.appLog.byAction('ai.accident_report.generate_failed').map((e) => e.details)).toEqual([
      { model: 'gemini-flash-latest', fallback: false, retryable: true, reason: 'unknown' },
      { model: 'gemini-2.5-flash', fallback: true, retryable: false, reason: 'unknown' },
    ]);
    await expect(
      generateAccidentReportDraft(deps, staff, { text: 'ころんだ', model: 'gemini-2.5-pro' }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'model_not_allowed' });
    expect(ai.models).toEqual(['gemini-flash-latest', 'gemini-2.5-flash']);
  });

  it('事故報告を切り替えた先のモデルで書けたら WARN で残す', async () => {
    const draft = {
      occurrenceTime: '10:00',
      location: '公園',
      accidentContent: 'a',
      situation: 'b',
      immediateResponse: 'c',
      parentCorrespondence: 'd',
      diagnosisTreatment: 'e',
      prevention: 'f',
    };
    ai.port.generateAccidentReport = async () => draft;
    const result = await generateAccidentReportDraft(deps, staff, {
      text: 'ころんだ',
      model: 'gemini-2.0-flash',
    });
    expect(result).toEqual({ draft, model: 'gemini-2.0-flash', retryable: false });
    expect(ctx.appLog.byAction('ai.accident_report.model_fallback_succeeded')[0]).toMatchObject({
      level: 'WARN',
      details: { model: 'gemini-2.0-flash', firstModel: 'gemini-flash-latest' },
    });
  });
});

describe('領収書の読み取り(Flash-Lite 系をサーバーの中で順に試す)', () => {
  let ctx: TestContext;
  let staff: Actor;
  let calls: (string | undefined)[];
  let answers: Record<string, ReceiptOcrResult>;
  let deps: ReportAiDeps;
  const ok: ReceiptOcrResult = { amount: 1200, storeName: '駐車場', receiptDate: '2026/09/25 10:00' };
  const busy: ReceiptOcrResult = {
    amount: '',
    storeName: '',
    receiptDate: '',
    error: '混み合っています',
    retryable: true,
  };

  beforeEach(async () => {
    ctx = createTestContext({ now: '2026-09-25T03:00:00Z' });
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    calls = [];
    answers = {};
    const port: ReportAiPort = {
      hasApiKey: true,
      availableModels: async () => [
        'gemini-2.5-flash',
        'gemini-flash-lite-latest',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash-lite-001',
      ],
      async generateDailyReport() {
        return { warnings: [], internal: '', customer: '' };
      },
      async generateAccidentReport() {
        return { error: 'unused' };
      },
      async extractReceiptAmount({ model }) {
        calls.push(model);
        return structuredClone(answers[model ?? ''] ?? busy);
      },
    };
    deps = {
      uow: ctx.uow,
      appLog: ctx.appLog,
      secretBox: ctx.secretBox,
      reportAi: port,
      reportAiFactory: { create: () => port },
      now: ctx.deps.now,
    };
  });

  it('先頭のモデルで読めればそれだけを呼び、ログは残さない', async () => {
    answers['gemini-flash-lite-latest'] = ok;
    expect(await extractReceiptAmount(deps, staff, 'data:image/jpeg;base64,AAAA')).toEqual(ok);
    expect(calls).toEqual(['gemini-flash-lite-latest']);
    expect(ctx.appLog.actions()).toEqual([]);
  });

  it('試し直す意味のある失敗なら次のモデルへ進み、失敗ごとにモデル名つきで残し、切り替え先で読めたら WARN', async () => {
    answers['gemini-2.5-flash-lite'] = ok;
    expect(await extractReceiptAmount(deps, staff, 'data:image/jpeg;base64,AAAA')).toEqual(ok);
    expect(calls).toEqual(['gemini-flash-lite-latest', 'gemini-2.5-flash-lite']);
    expect(ctx.appLog.byAction('ai.receipt_ocr.failed').map((e) => e.details)).toMatchObject([
      { model: 'gemini-flash-lite-latest', attempt: 1, retryable: true },
    ]);
    expect(ctx.appLog.byAction('ai.receipt_ocr.model_fallback_succeeded')[0]).toMatchObject({
      level: 'WARN',
      details: { model: 'gemini-2.5-flash-lite', firstModel: 'gemini-flash-lite-latest', attempt: 2 },
    });
  });

  it('試すのは 3つまで。全部だめなら最後の失敗を返す(retryable は画面に返さない)', async () => {
    const result = await extractReceiptAmount(deps, staff, 'data:image/jpeg;base64,AAAA');
    expect(calls).toEqual(['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash-lite']);
    expect(result).toEqual({ amount: '', storeName: '', receiptDate: '', error: '混み合っています' });
    expect(ctx.appLog.byAction('ai.receipt_ocr.failed')).toHaveLength(3);
  });

  it('API キーの誤りなど試し直す意味の無い失敗では次のモデルに進まない', async () => {
    answers['gemini-flash-lite-latest'] = { ...busy, error: 'APIキーが無効です', retryable: false };
    const result = await extractReceiptAmount(deps, staff, 'data:image/jpeg;base64,AAAA');
    expect(calls).toEqual(['gemini-flash-lite-latest']);
    expect(result.error).toBe('APIキーが無効です');
    expect(ctx.appLog.byAction('ai.receipt_ocr.failed')[0]?.details).toMatchObject({
      model: 'gemini-flash-lite-latest',
      retryable: false,
    });
    expect(JSON.stringify(ctx.appLog.byAction('ai.receipt_ocr.failed')[0]?.details)).not.toContain('APIキー');
  });

  it('API キーが無ければモデルを指定せずに1回だけ呼ぶ', async () => {
    const port = { ...deps.reportAi, hasApiKey: false };
    deps = { ...deps, reportAi: port, reportAiFactory: { create: () => port } };
    await extractReceiptAmount(deps, staff, 'data:image/jpeg;base64,AAAA');
    expect(calls).toEqual([undefined]);
  });
});
