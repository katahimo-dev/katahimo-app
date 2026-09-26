import { AI_PROMPT_KEYS, findAiPromptDefinition } from '@katahimo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReportAiPort } from '../ports/ai';
import { getUiConfig, listAiPromptsForAdmin, updateAiPrompts } from './aiPrompts';
import type { ReportAiDeps } from './reportAi';
import { generateDailyReportDraft } from './reportAi';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';
import type { FakeAppLogPort, FakeUnitOfWork } from './testDoubles';

describe('AIプロンプト・UI設定', () => {
  let ctx: TestContext;
  let tenantId: string;
  let otherTenantId: string;
  let uow: FakeUnitOfWork;
  let appLog: FakeAppLogPort;
  const ADMIN = '00000000-0000-7000-8000-0000000000aa';

  beforeEach(() => {
    ctx = createTestContext();
    tenantId = ctx.tenantId;
    otherTenantId = ctx.db.addTenant({ slug: 'other' }).id;
    uow = ctx.uow;
    appLog = ctx.appLog;
  });

  it('上書きが無ければGAS版と同じ既定の文言・評価定義を返す', async () => {
    const config = await getUiConfig({ uow }, tenantId);
    expect(config.dailyPlaceholder.startsWith('①訪問当日のサポート内容')).toBe(true);
    expect(config.accidentHint.startsWith('事故報告書 記載項目と記載要領')).toBe(true);
    expect(config.assessments.risk.title).toBe('PSI');
    expect(config.assessments.es.levels).toHaveLength(5);
  });

  it('管理者が編集したプレースホルダーはそのテナントだけに反映され、空で保存すると既定値に戻る', async () => {
    const result = await updateAiPrompts(
      { uow, appLog },
      {
        tenantId,
        staffId: ADMIN,
        prompts: [{ key: AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER, body: '独自の記入例' }],
      },
    );
    expect(result.ok).toBe(true);
    expect((await getUiConfig({ uow }, tenantId)).dailyPlaceholder).toBe('独自の記入例');
    expect((await getUiConfig({ uow }, otherTenantId)).dailyPlaceholder).not.toBe('独自の記入例');
    expect(appLog.entries.at(-1)).toMatchObject({ action: 'settings.ai_prompts.updated' });

    const list = await listAiPromptsForAdmin({ uow }, tenantId);
    expect(list.find((p) => p.key === AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER)).toMatchObject({
      customized: true,
    });

    await updateAiPrompts(
      { uow, appLog },
      { tenantId, staffId: ADMIN, prompts: [{ key: AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER, body: '' }] },
    );
    expect((await getUiConfig({ uow }, tenantId)).dailyPlaceholder).toBe(
      findAiPromptDefinition(AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER)?.defaultBody,
    );
  });

  it('未知のkeyが含まれていれば何も更新しない', async () => {
    const result = await updateAiPrompts(
      { uow, appLog },
      {
        tenantId,
        staffId: ADMIN,
        prompts: [
          { key: AI_PROMPT_KEYS.DAILY_MEMO_PLACEHOLDER, body: 'x' },
          { key: 'no.such.key', body: 'y' },
        ],
      },
    );
    expect(result).toEqual({ ok: false, reason: 'unknown_key', keys: ['no.such.key'] });
    expect(ctx.data().aiPrompts).toEqual([]);
  });

  it('日報のAI生成はテナントのプロンプトを使い、無ければ既定のプロンプトを使う', async () => {
    const templates: string[] = [];
    const port: ReportAiPort = {
      async generateDailyReport(input) {
        templates.push(input.promptTemplate);
        return { warnings: [], internal: '', customer: '' };
      },
      async generateAccidentReport() {
        return { error: 'unused' };
      },
      async extractReceiptAmount() {
        return { amount: '', storeName: '', receiptDate: '' };
      },
    };
    const deps: ReportAiDeps = {
      uow,
      reportAi: port,
      secretBox: ctx.secretBox,
      reportAiFactory: { create: () => port },
      appLog,
    };
    const caller = { tenantId, staffId: ADMIN };
    await generateDailyReportDraft(deps, caller, { text: 'メモ' });
    await uow.run(tenantId, (r) =>
      r.aiPrompts.save({
        kind: 'prompt',
        key: AI_PROMPT_KEYS.DAILY_REPORT_GENERATE,
        body: '独自プロンプト {anonymizedText}',
        updatedBy: ADMIN,
      }),
    );
    await generateDailyReportDraft(deps, caller, { text: 'メモ' });
    expect(templates[0]).toBe(findAiPromptDefinition(AI_PROMPT_KEYS.DAILY_REPORT_GENERATE)?.defaultBody);
    expect(templates[1]).toBe('独自プロンプト {anonymizedText}');
  });
});
