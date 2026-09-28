import { beforeEach, describe, expect, it } from 'vitest';
import { parseReportAiWorkbook } from '../domain';
import { syntheticMasterSheets } from '../testSupport/reportAiFixtures';
import { getCustomerReportProfile, saveCustomerReportProfile } from './customerReportProfiles';
import {
  archiveReportAiRow,
  exportReportAiMasters,
  findAgeBandOverlap,
  importReportAiMasters,
  listReportAiMasters,
  reportAiKeywordUsage,
  saveReportAiLevel,
  saveReportAiRow,
} from './reportAiAdmin';
import type { Actor } from './requestMeta';
import { createTestContext, type TestContext } from './testContext';

const keyword = (code: string, overrides: Record<string, unknown> = {}) => ({
  code,
  category: null,
  keyword: `語${code}`,
  subConcept: null,
  ageLabel: null,
  ageFromMonths: 0,
  ageToMonths: 84,
  ageBandLabel: null,
  educationLevelMin: 3,
  educationLevelMax: 5,
  psiMin: 3,
  tone: null,
  parentExplanation: null,
  phraseExamples: null,
  usageScene: null,
  ngExample: null,
  sortOrder: 0,
  ...overrides,
});

const band = (label: string, from: number, to: number) => ({
  label,
  ageFromMonths: from,
  ageToMonths: to,
  behaviorWords: null,
  developmentTopics: null,
  keywordCodes: [],
  sceneExamples: null,
  sortOrder: 0,
});

describe('日報AIの調整(管理画面)', () => {
  let ctx: TestContext;
  let admin: Actor;

  beforeEach(async () => {
    ctx = createTestContext();
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
  });

  describe('行ごとの編集', () => {
    it('足す・書き換える(版が古ければ 409)・外す、を操作ログに残す', async () => {
      const created = await saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K01'));
      const updated = await saveReportAiRow(
        ctx.deps,
        admin,
        'keywords',
        created.id,
        keyword('K01', { keyword: '変えた' }),
        created.rowVersion,
      );
      expect(updated.rowVersion).toBe(2);
      await expect(
        saveReportAiRow(ctx.deps, admin, 'keywords', created.id, keyword('K01'), created.rowVersion),
      ).rejects.toMatchObject({ code: 'conflict', reason: 'stale_row_version' });
      expect((await listReportAiMasters(ctx.deps, admin)).keywords.map((k) => k.keyword)).toEqual(['変えた']);
      await archiveReportAiRow(ctx.deps, admin, 'keywords', created.id, updated.rowVersion);
      expect((await listReportAiMasters(ctx.deps, admin)).keywords).toEqual([]);
      expect(ctx.appLog.actions()).toEqual([
        'settings.report_ai.row_saved',
        'settings.report_ai.row_saved',
        'settings.report_ai.save_rejected',
        'settings.report_ai.row_archived',
      ]);
    });

    it('同じ ID のキーワードは足せない(外した行と同じ ID なら、その行を戻す)', async () => {
      const first = await saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K01'));
      await expect(saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K01'))).rejects.toMatchObject({
        code: 'conflict',
        reason: 'duplicate_key',
      });
      await archiveReportAiRow(ctx.deps, admin, 'keywords', first.id);
      const revived = await saveReportAiRow(
        ctx.deps,
        admin,
        'keywords',
        null,
        keyword('K01', { keyword: '戻した' }),
      );
      expect(revived.id).toBe(first.id);
      expect((await listReportAiMasters(ctx.deps, admin)).keywords.map((k) => k.keyword)).toEqual(['戻した']);
    });

    it('別の行を、外した行と同じ ID に書き換えることはできない(409。キーの一意制約は外した行にもかかる)', async () => {
      const archived = await saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K01'));
      await archiveReportAiRow(ctx.deps, admin, 'keywords', archived.id);
      const other = await saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K02'));
      const rejected = saveReportAiRow(
        ctx.deps,
        admin,
        'keywords',
        other.id,
        keyword('K01'),
        other.rowVersion,
      );
      await expect(rejected).rejects.toMatchObject({ code: 'conflict', reason: 'duplicate_key' });
      await expect(rejected).rejects.toThrow(/アーカイブされています/);
      expect((await listReportAiMasters(ctx.deps, admin)).keywords.map((k) => k.code)).toEqual(['K02']);
    });

    it('年齢帯の月齢範囲は重ねられない(隣り合う帯は重ならない)', async () => {
      await saveReportAiRow(ctx.deps, admin, 'ageBands', null, band('0-6ヶ月', 0, 6));
      await saveReportAiRow(ctx.deps, admin, 'ageBands', null, band('6-12ヶ月', 6, 12));
      await expect(
        saveReportAiRow(ctx.deps, admin, 'ageBands', null, band('重なる', 10, 20)),
      ).rejects.toMatchObject({
        code: 'validation_failed',
        reason: 'age_band_overlap',
      });
      expect((await listReportAiMasters(ctx.deps, admin)).ageBands).toHaveLength(2);
      expect(findAgeBandOverlap([band('a', 0, 12), band('b', 12, 24)])).toBeNull();
    });

    it('★・PSI の段階は無ければ作り、あれば版を確かめて書き換える', async () => {
      const level = {
        level: 3,
        label: 'やや関心あり',
        customerProfile: null,
        usage: null,
        wordScope: null,
        termNameRule: null,
        termNamePolicy: 'sparing' as const,
        keywordsMin: 1,
        keywordsMax: 1,
        toneFocus: null,
        exampleDirection: null,
      };
      const created = await saveReportAiLevel(ctx.deps, admin, 'educationLevels', level);
      await expect(saveReportAiLevel(ctx.deps, admin, 'educationLevels', level, 99)).rejects.toMatchObject({
        code: 'conflict',
      });
      await saveReportAiLevel(
        ctx.deps,
        admin,
        'educationLevels',
        { ...level, label: '変えた' },
        created.rowVersion,
      );
      expect((await listReportAiMasters(ctx.deps, admin)).educationLevels.map((l) => l.label)).toEqual([
        '変えた',
      ]);
    });
  });

  describe('xlsx の取込', () => {
    it('確かめるだけ(dryRun)は件数だけを返して何も書かず、反映は1回の取込で全ての表を書く', async () => {
      const parsed = parseReportAiWorkbook(syntheticMasterSheets());
      const preview = await importReportAiMasters(ctx.deps, admin, {
        parsed,
        dryRun: true,
        fileName: 'm.xlsx',
      });
      expect(preview).toMatchObject({ dryRun: true, applied: false, errors: [] });
      expect(preview.counts.keywords).toEqual({ rows: 3, created: 3, updated: 0, unchanged: 0 });
      expect((await listReportAiMasters(ctx.deps, admin)).keywords).toEqual([]);
      expect(ctx.data().importRuns).toEqual([]);

      const applied = await importReportAiMasters(ctx.deps, admin, {
        parsed,
        dryRun: false,
        fileName: 'm.xlsx',
      });
      expect(applied).toMatchObject({ applied: true, errors: [] });
      expect(applied.counts.psiLevels).toEqual({ rows: 5, created: 5, updated: 0, unchanged: 0 });
      const masters = await listReportAiMasters(ctx.deps, admin);
      expect(
        [masters.keywords, masters.ageBands, masters.educationLevels, masters.psiLevels].map((l) => l.length),
      ).toEqual([3, 3, 5, 5]);
      expect(masters.phrases).toHaveLength(3);
      expect(masters.stanceRules).toHaveLength(2);
      expect(ctx.data().importRuns).toMatchObject([
        { source: 'report_ai_xlsx', status: 'applied', fileName: 'm.xlsx', counts: { keywords_created: 3 } },
      ]);
      expect(ctx.appLog.actions()).toContain('settings.report_ai.imported');

      // 同じファイルをもう一度: 全て変わらない。行を1つ変えると、その行だけ書き換える(ファイルに無い行は消さない)
      await saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K99'));
      const again = await importReportAiMasters(ctx.deps, admin, { parsed, dryRun: false, fileName: null });
      expect(again.counts.keywords).toEqual({ rows: 3, created: 0, updated: 0, unchanged: 3 });
      const changed = {
        ...parsed,
        keywords: parsed.keywords.map((k, i) => (i === 0 ? { ...k, keyword: '新しい語' } : k)),
      };
      const third = await importReportAiMasters(ctx.deps, admin, {
        parsed: changed,
        dryRun: false,
        fileName: null,
      });
      expect(third.counts.keywords).toEqual({ rows: 3, created: 0, updated: 1, unchanged: 2 });
      expect((await listReportAiMasters(ctx.deps, admin)).keywords.map((k) => k.code)).toContain('K99');
    });

    it('誤りがあれば(読み取りの誤り・取込後の年齢帯の重なり)何も書かない', async () => {
      await saveReportAiRow(ctx.deps, admin, 'ageBands', null, band('既存', 0, 12));
      const parsed = parseReportAiWorkbook(syntheticMasterSheets());
      const result = await importReportAiMasters(ctx.deps, admin, { parsed, dryRun: false, fileName: null });
      expect(result.applied).toBe(false);
      expect(result.errors).toEqual([
        { sheet: '年齢帯', row: null, message: expect.stringContaining('重なっています') },
      ]);
      expect((await listReportAiMasters(ctx.deps, admin)).keywords).toEqual([]);
      expect(ctx.appLog.actions()).toContain('settings.report_ai.import_rejected');
    });

    it('年齢帯の相性の良いキーワードID が表に無ければ知らせる(反映はする)', async () => {
      const parsed = parseReportAiWorkbook(syntheticMasterSheets());
      parsed.ageBands = parsed.ageBands.map((b, i) => (i === 0 ? { ...b, keywordCodes: ['K02', 'K77'] } : b));
      const result = await importReportAiMasters(ctx.deps, admin, { parsed, dryRun: true, fileName: null });
      expect(result.warnings.some((w) => w.message.includes('K77'))).toBe(true);
    });
  });

  it('書き出し・キーワードの利用状況(期間の候補・使用・候補外の回数)を操作ログに残す', async () => {
    const k1 = await saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K01'));
    await saveReportAiRow(ctx.deps, admin, 'keywords', null, keyword('K02'));
    const customerId = await ctx.addCustomer('佐藤 花子');
    await ctx.uow.run(ctx.tenantId, (r) =>
      r.reportAiGenerations.insert({
        id: '00000000-0000-7000-8000-0000000000e1',
        staffId: admin.staffId,
        customerId,
        careRecipientId: null,
        promptKey: 'daily_report.generate',
        promptRevision: null,
        defaultPromptSha256: 'x',
        appVersion: null,
        model: null,
        promptText: 'p',
        inputText: 'i',
        timeInfo: 't',
        startedAt: new Date('2026-09-20T01:00:00Z'),
        finishedAt: new Date('2026-09-20T01:00:01Z'),
        childAgeMonths: null,
        educationLevel: 2,
        effectiveEducationLevel: 2,
        riskRating: null,
        escalationRequired: false,
        candidateKeywordIds: [k1.id],
        usedKeywordIds: [k1.id],
        // 候補外の語(K02)と表に無い答えは、使った回数に数えず別に数える
        unresolvedUsedCodes: ['K02 語K02', '謎の語'],
        output: {},
        errorCode: null,
      }),
    );
    const rows = await reportAiKeywordUsage(ctx.deps, admin, { from: '2026-09-01', to: '2026-09-30' });
    expect(rows.map((r) => [r.code, r.candidateCount, r.usedCount, r.notOfferedCount])).toEqual([
      ['K01', 1, 1, 0],
      ['K02', 0, 0, 1],
      ['(表に無い答え)', 0, 0, 1],
    ]);
    expect(
      (await reportAiKeywordUsage(ctx.deps, admin, { from: '2026-09-21', to: '2026-09-30' }))[0],
    ).toMatchObject({
      candidateCount: 0,
    });
    await exportReportAiMasters(ctx.deps, admin);
    expect(ctx.appLog.actions()).toEqual(
      expect.arrayContaining(['settings.report_ai.usage_exported', 'settings.report_ai.exported']),
    );
  });
});

describe('家庭ごとの教育思考★', () => {
  it('どのスタッフも見られて変えられ、他の人が先に変えていれば 409', async () => {
    const ctx = createTestContext();
    const staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    const other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    const customerId = await ctx.addCustomer('佐藤 花子');
    expect(await getCustomerReportProfile(ctx.deps, staff, customerId)).toMatchObject({
      educationLevel: null,
      rowVersion: null,
    });
    const first = await saveCustomerReportProfile(ctx.deps, staff, customerId, { educationLevel: 4 });
    expect(first).toMatchObject({ educationLevel: 4, rowVersion: 1, updatedByName: '山田 太郎' });
    // 未設定のつもりで(版なしで)保存した他の人は 409
    await expect(
      saveCustomerReportProfile(ctx.deps, other, customerId, { educationLevel: 2 }),
    ).rejects.toMatchObject({
      code: 'conflict',
    });
    const second = await saveCustomerReportProfile(ctx.deps, other, customerId, {
      educationLevel: 2,
      rowVersion: 1,
    });
    expect(second).toMatchObject({ educationLevel: 2, rowVersion: 2, updatedByName: '鈴木 次郎' });
    expect(ctx.appLog.byAction('customer.report_profile.updated').map((l) => l.details)).toEqual([
      { customerId, from: null, to: 4 },
      { customerId, from: 4, to: 2 },
    ]);
    expect(ctx.appLog.actions()).toContain('customer.report_profile.update_rejected');
    await expect(
      getCustomerReportProfile(ctx.deps, staff, '00000000-0000-7000-8000-00000000ffff'),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('null で未設定に戻す(行は残して版は続く。古い版は 409)', async () => {
    const ctx = createTestContext();
    const staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    const customerId = await ctx.addCustomer('佐藤 花子');
    await saveCustomerReportProfile(ctx.deps, staff, customerId, { educationLevel: 5 });
    const cleared = await saveCustomerReportProfile(ctx.deps, staff, customerId, {
      educationLevel: null,
      rowVersion: 1,
    });
    expect(cleared).toMatchObject({ educationLevel: null, rowVersion: 2, updatedByName: '山田 太郎' });
    expect(await getCustomerReportProfile(ctx.deps, staff, customerId)).toMatchObject({
      educationLevel: null,
      rowVersion: 2,
    });
    await expect(
      saveCustomerReportProfile(ctx.deps, staff, customerId, { educationLevel: 3, rowVersion: 1 }),
    ).rejects.toMatchObject({ code: 'conflict' });
    const again = await saveCustomerReportProfile(ctx.deps, staff, customerId, {
      educationLevel: 3,
      rowVersion: 2,
    });
    expect(again).toMatchObject({ educationLevel: 3, rowVersion: 3 });
    expect(ctx.appLog.byAction('customer.report_profile.updated').map((l) => l.details)).toEqual([
      { customerId, from: null, to: 5 },
      { customerId, from: 5, to: null },
      { customerId, from: null, to: 3 },
    ]);
    // 行の無い家庭を未設定にしても、null の行を作るだけ(次からは版つきで保存する)
    const fresh = await ctx.addCustomer('田中 一郎');
    expect(await saveCustomerReportProfile(ctx.deps, staff, fresh, { educationLevel: null })).toMatchObject({
      educationLevel: null,
      rowVersion: 1,
    });
  });
});
