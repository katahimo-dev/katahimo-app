import { AI_PROMPT_KEYS, findAiPromptDefinition } from '@katahimo/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { getUiConfig, listAiPromptsForAdmin, updateAiPrompts } from './aiPrompts';
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

  it('一覧の版(revision)を渡すと、他の管理者が先に保存していれば何も変えずに conflict にする', async () => {
    const key = AI_PROMPT_KEYS.ACCIDENT_WRITING_HINT;
    const revisionOf = async () =>
      (await listAiPromptsForAdmin({ uow }, tenantId)).find((p) => p.key === key)?.revision;
    expect(await revisionOf()).toBe(0);
    await updateAiPrompts(
      { uow, appLog },
      { tenantId, staffId: ADMIN, prompts: [{ key, body: 'A', revision: 0 }] },
    );
    expect(await revisionOf()).toBe(1);
    await expect(
      updateAiPrompts(
        { uow, appLog },
        { tenantId, staffId: ADMIN, prompts: [{ key, body: 'B', revision: 0 }] },
      ),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'stale_revision' });
    expect(appLog.entries.at(-1)).toMatchObject({
      level: 'WARN',
      action: 'settings.ai_prompts.update_rejected',
      details: { reason: 'stale_revision' },
    });
    // 既定値に戻しても版は続く(戻した後に古い版で保存しても競合になる)
    await updateAiPrompts(
      { uow, appLog },
      { tenantId, staffId: ADMIN, prompts: [{ key, body: null, revision: 1 }] },
    );
    expect(await revisionOf()).toBe(2);
    await expect(
      updateAiPrompts(
        { uow, appLog },
        { tenantId, staffId: ADMIN, prompts: [{ key, body: 'C', revision: 1 }] },
      ),
    ).rejects.toMatchObject({ reason: 'stale_revision' });
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
});
