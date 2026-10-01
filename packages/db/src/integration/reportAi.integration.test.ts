import { newId } from '@katahimo/core/domain';
import type { ReportAiGenerationInput, TenantDirectoryPort, TenantRepositories } from '@katahimo/core/ports';
import { FakeAppLogPort, FakeStoragePort, reportAiFixtureMasters } from '@katahimo/core/test-utils';
import { runMaintenance } from '@katahimo/core/usecases';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { pgErrorOf } from '../errors';
import { DrizzlePlatformMaintenance } from '../repositories/platform/maintenance';
import { DrizzleTenantDirectory } from '../repositories/platform/tenants';
import { DrizzleUnitOfWork } from '../uow';
import { connect, reportBody } from './testDb';

/**
 * 日報AIの調整の表(マスター・家庭の★・AI 生成の記録)を実際の DB で確かめる: テナントの分離(RLS)、
 * 年齢帯の月齢範囲の重なり(コミット時の EXCLUDE)、生成の記録の追記のみ(結び付けの列だけ書ける)、
 * 保守ジョブの保存期間の削除(katahimo_worker の権限)。
 */
const { app, owner, worker, uow, createTenant, createStaff, createCustomer } = connect();

const band = (label: string, from: number, to: number) => ({
  label,
  ageFromMonths: from,
  ageToMonths: to,
  behaviorWords: null,
  developmentTopics: null,
  keywordCodes: ['K01'],
  sceneExamples: null,
  sortOrder: 0,
});

function generation(staffId: string, customerId: string, overrides: Partial<ReportAiGenerationInput> = {}) {
  return {
    id: newId(),
    staffId,
    customerId,
    careRecipientId: null,
    promptKey: 'daily_report.generate',
    promptRevision: null,
    defaultPromptSha256: 'a'.repeat(64),
    appVersion: null,
    model: 'gemini-test',
    promptText: 'プロンプト',
    inputText: 'メモ',
    timeInfo: '09:00〜12:00',
    startedAt: new Date(),
    finishedAt: new Date(),
    childAgeMonths: 14,
    educationLevel: 2,
    effectiveEducationLevel: 2,
    riskRating: 4,
    escalationRequired: false,
    candidateKeywordIds: [newId()],
    usedKeywordIds: [],
    unresolvedUsedCodes: ['X99'],
    output: { warnings: [], internal: 'i', customer: 'c' },
    errorCode: null,
    ...overrides,
  } satisfies ReportAiGenerationInput;
}

async function careRecord(r: TenantRepositories, staffId: string, customerId: string, retainUntil: string) {
  return (
    await r.careRecords.insert({
      id: newId(),
      recordType: 'daily_report',
      status: 'submitted',
      visitId: null,
      customerId,
      careRecipientId: null,
      authorStaffId: staffId,
      occurredAt: new Date(),
      servicePeriod: null,
      riskRating: 4,
      esRating: null,
      body: reportBody('v1'),
      bodySchemaVer: 1,
      retainUntil,
    })
  ).id;
}

describe('日報AIの調整の表', () => {
  it('マスター・家庭の★・生成の記録は他のテナントから見えない', async () => {
    const [a, b] = await Promise.all([createTenant('rai'), createTenant('rai')]);
    const { staffId, customerId } = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      await r.reportAi.insertRow('ageBands', newId(), band('1歳', 12, 24), staffId);
      await r.customerReportProfiles.save(customerId, 4, staffId, undefined);
      await r.reportAiGenerations.insert(generation(staffId, customerId));
      return { staffId, customerId };
    });
    const fromB = await uow.run(b, async (r) => ({
      masters: await r.reportAi.listRecords(),
      profile: await r.customerReportProfiles.find(customerId),
    }));
    expect(fromB.masters.ageBands).toEqual([]);
    expect(fromB.profile).toBeNull();
    const own = await uow.run(a, (r) => r.reportAi.loadActive());
    expect(own.ageBands.map((x) => x.keywordCodes)).toEqual([['K01']]);
    expect(staffId).toBeTruthy();
  });

  it('年齢帯の月齢範囲の重なりはコミットのときに止める(1つのトランザクションの中の入れ替えは通す)', async () => {
    const tenantId = await createTenant('rai');
    const staffId = await uow.run(tenantId, (r) => createStaff(r));
    const infant = await uow.run(tenantId, async (r) => {
      const meta = await r.reportAi.insertRow('ageBands', newId(), band('0-12ヶ月', 0, 12), staffId);
      return meta.id;
    });
    // 「0〜12ヶ月」を「0〜6」「6〜12」に分ける(途中では重なる)
    await uow.run(tenantId, async (r) => {
      await r.reportAi.insertRow('ageBands', newId(), band('6-12ヶ月', 6, 12), staffId);
      await r.reportAi.updateRow('ageBands', infant, band('0-6ヶ月', 0, 6), staffId);
    });
    await expect(
      uow.run(tenantId, (r) => r.reportAi.insertRow('ageBands', newId(), band('重なる', 10, 20), staffId)),
    ).rejects.toMatchObject({ code: 'conflict' });
    // アーカイブした帯とは重なってよい
    await uow.run(tenantId, async (r) => {
      await r.reportAi.archiveRow('ageBands', infant, staffId);
      await r.reportAi.insertRow('ageBands', newId(), band('0-3ヶ月', 0, 3), staffId);
    });
    expect((await uow.run(tenantId, (r) => r.reportAi.listRecords())).ageBands.map((x) => x.label)).toEqual([
      '0-3ヶ月',
      '6-12ヶ月',
    ]);
  });

  it('アプリは生成の記録の結び付けの列だけ書け、別の日報には結び付け直さない(答え・プロンプトは書き換えられない)', async () => {
    const tenantId = await createTenant('rai');
    const g = await uow.run(tenantId, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      const row = generation(staffId, customerId);
      await r.reportAiGenerations.insert(row);
      const recordId = await careRecord(r, staffId, customerId, '2031-01-01');
      expect(await r.reportAiGenerations.linkToCareRecord(row.id, recordId)).toBe(true);
      // 同じ日報へは結び付け直せる。別の日報には結び付けない(書かずに false)
      expect(await r.reportAiGenerations.linkToCareRecord(row.id, recordId)).toBe(true);
      const otherRecord = await careRecord(r, staffId, customerId, '2031-01-02');
      expect(await r.reportAiGenerations.linkToCareRecord(row.id, otherRecord)).toBe(false);
      return { id: row.id, recordId };
    });
    expect((await uow.run(tenantId, (r) => r.reportAiGenerations.findById(g.id)))?.careRecordId).toBe(
      g.recordId,
    );
    const sqlState = (statement: ReturnType<typeof sql>) =>
      withTenant(app, tenantId, (tx) => tx.execute(statement)).then(
        () => 'ok',
        (error: unknown) => pgErrorOf(error)?.code,
      );
    const INSUFFICIENT_PRIVILEGE = '42501';
    expect(
      await sqlState(sql`update report_ai_generations set output = '{}'::jsonb where id = ${g.id}`),
    ).toBe(INSUFFICIENT_PRIVILEGE);
    expect(await sqlState(sql`delete from report_ai_generations where id = ${g.id}`)).toBe(
      INSUFFICIENT_PRIVILEGE,
    );
    // 答えと失敗の種類はちょうど一方
    await expect(
      uow.run(tenantId, async (r) => {
        const staffId = await createStaff(r, '別 人');
        const customerId = await createCustomer(r);
        await r.reportAiGenerations.insert(generation(staffId, customerId, { errorCode: 'api_error' }));
      }),
    ).rejects.toThrow();
  });

  it('利用状況: 期間の生成のキーワードごとの候補・使用の回数と、候補に直せなかった答えごとの回数', async () => {
    const tenantId = await createTenant('rai');
    const [k1, k2] = [newId(), newId()];
    const usage = await uow.run(tenantId, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      await r.reportAiGenerations.insert(
        generation(staffId, customerId, {
          candidateKeywordIds: [k1, k2],
          usedKeywordIds: [k1],
          unresolvedUsedCodes: ['K03', '謎の語'],
        }),
      );
      await r.reportAiGenerations.insert(
        generation(staffId, customerId, {
          candidateKeywordIds: [k1],
          usedKeywordIds: [],
          unresolvedUsedCodes: ['K03'],
        }),
      );
      const from = new Date(Date.now() - 60_000);
      const to = new Date(Date.now() + 60_000);
      return {
        keywords: await r.reportAiGenerations.keywordUsage(from, to),
        answers: await r.reportAiGenerations.unresolvedAnswerUsage(from, to),
        empty: await r.reportAiGenerations.unresolvedAnswerUsage(to, new Date(to.getTime() + 60_000)),
      };
    });
    expect(usage.keywords.sort((a, b) => b.candidateCount - a.candidateCount)).toEqual([
      { keywordId: k1, candidateCount: 2, usedCount: 1 },
      { keywordId: k2, candidateCount: 1, usedCount: 0 },
    ]);
    expect(usage.answers.sort((a, b) => b.count - a.count)).toEqual([
      { answer: 'K03', count: 2 },
      { answer: '謎の語', count: 1 },
    ]);
    expect(usage.empty).toEqual([]);
  });

  it.skipIf(!worker)(
    '保守ジョブは結び付いていない古い記録と、保存期限を過ぎた日報の記録を消す(ワーカーの権限)',
    async () => {
      const tenantId = await createTenant('rai');
      const ids = await uow.run(tenantId, async (r) => {
        const staffId = await createStaff(r);
        const customerId = await createCustomer(r);
        const expired = await careRecord(r, staffId, customerId, '2020-01-01');
        const kept = await careRecord(r, staffId, customerId, '2099-01-01');
        const rows = {
          oldUnlinked: generation(staffId, customerId),
          recentUnlinked: generation(staffId, customerId),
          linkedExpired: generation(staffId, customerId),
          linkedKept: generation(staffId, customerId),
        };
        for (const row of Object.values(rows)) await r.reportAiGenerations.insert(row);
        await r.reportAiGenerations.linkToCareRecord(rows.linkedExpired.id, expired);
        await r.reportAiGenerations.linkToCareRecord(rows.linkedKept.id, kept);
        return Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.id])) as Record<
          keyof typeof rows,
          string
        >;
      });
      await withTenant(owner, tenantId, (tx) =>
        tx.execute(
          sql`update report_ai_generations set created_at = now() - interval '400 days' where id in (${ids.oldUnlinked}, ${ids.linkedKept})`,
        ),
      );
      const workerDb = worker as NonNullable<typeof worker>;
      const tenants = new DrizzleTenantDirectory(workerDb);
      const tenant = await tenants.findById(tenantId);
      if (!tenant) throw new Error('テナントがありません');
      const onlyThisTenant: TenantDirectoryPort = {
        findBySlug: (slug) => tenants.findBySlug(slug),
        findById: (id) => tenants.findById(id),
        listActive: async () => [tenant],
        listAll: async () => [tenant],
      };
      const appLog = new FakeAppLogPort();
      const summary = await runMaintenance({
        uow: new DrizzleUnitOfWork(workerDb),
        tenants: onlyThisTenant,
        platform: new DrizzlePlatformMaintenance(workerDb),
        storage: new FakeStoragePort(),
        appLog,
        appLogRetentionMonths: 13,
      });
      expect(summary.tenants[0]?.error).toBeUndefined();
      expect(summary.tenants[0]?.deleted).toMatchObject({ report_ai_generations: 2 });
      const left = (await withTenant(owner, tenantId, (tx) =>
        tx.execute(sql`select id from report_ai_generations order by id`),
      )) as unknown as { id: string }[];
      expect(left.map((l) => l.id).sort()).toEqual([ids.recentUnlinked, ids.linkedKept].sort());
    },
  );
});

describe('運用のモデル比較の読み取り(listForComparison・findKeywordsByIds)', () => {
  it('成功した生成を新しい順に読み、ID の指定は成否を問わない。他のテナントの記録・語は見えない', async () => {
    const [a, b] = await Promise.all([createTenant('raicmp'), createTenant('raicmp')]);
    const base = new Date('2026-09-20T00:00:00Z');
    const at = (minutes: number) => new Date(base.getTime() + minutes * 60_000);
    const ids = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      const [k1, k2] = reportAiFixtureMasters().keywords;
      const keywordIds = [newId(), newId()];
      for (const [i, k] of [k1, k2].entries()) {
        const { id: _id, ...value } = k as NonNullable<typeof k1>;
        await r.reportAi.insertRow('keywords', keywordIds[i] as string, value, staffId);
      }
      // アーカイブした語も ID で読める(当時の候補を語に戻す)
      await r.reportAi.archiveRow('keywords', keywordIds[1] as string, staffId);
      const old = generation(staffId, customerId, { startedAt: at(0), finishedAt: at(0) });
      const failed = generation(staffId, customerId, {
        startedAt: at(1),
        finishedAt: at(1),
        output: null,
        errorCode: 'api_error',
      });
      const recent = generation(staffId, customerId, {
        startedAt: at(2),
        finishedAt: at(2),
        candidateKeywordIds: [keywordIds[1] as string, keywordIds[0] as string],
      });
      const accident = generation(staffId, customerId, {
        startedAt: at(3),
        finishedAt: at(3),
        promptKey: 'accident_report.generate',
      });
      for (const g of [old, failed, recent, accident]) await r.reportAiGenerations.insert(g);
      return {
        staffId,
        customerId,
        keywordIds,
        old: old.id,
        failed: failed.id,
        recent: recent.id,
        accident: accident.id,
      };
    });
    // created_at は DB の既定(now())なので、並びを確かめるために所有者で書き換える
    await withTenant(owner, a, async (tx) => {
      for (const [id, minutes] of [
        [ids.old, 0],
        [ids.failed, 1],
        [ids.recent, 2],
        [ids.accident, 3],
      ] as const) {
        await tx.execute(
          sql`update report_ai_generations set created_at = ${at(minutes).toISOString()}::timestamptz where id = ${id}`,
        );
      }
    });

    const latest = await uow.run(a, (r) =>
      r.reportAiGenerations.listForComparison({ promptKey: 'daily_report.generate', limit: 10 }),
    );
    expect(latest.map((g) => g.id)).toEqual([ids.recent, ids.old]);
    expect(latest[0]).toMatchObject({
      promptText: 'プロンプト',
      inputText: 'メモ',
      output: { internal: 'i' },
    });
    const since = await uow.run(a, (r) =>
      r.reportAiGenerations.listForComparison({
        promptKey: 'daily_report.generate',
        limit: 10,
        since: at(2),
      }),
    );
    expect(since.map((g) => g.id)).toEqual([ids.recent]);
    const limited = await uow.run(a, (r) =>
      r.reportAiGenerations.listForComparison({ promptKey: 'daily_report.generate', limit: 1 }),
    );
    expect(limited.map((g) => g.id)).toEqual([ids.recent]);
    const byIds = await uow.run(a, (r) =>
      r.reportAiGenerations.listForComparison({
        promptKey: 'daily_report.generate',
        ids: [ids.failed, ids.accident, ids.old],
        limit: 3,
      }),
    );
    expect(byIds.map((g) => g.id)).toEqual([ids.failed, ids.old]);
    const keywords = await uow.run(a, (r) =>
      r.reportAi.findKeywordsByIds([ids.keywordIds[1] as string, newId(), ids.keywordIds[0] as string]),
    );
    expect(keywords.map((k) => k.code)).toEqual(['K02', 'K01']);

    const fromB = await uow.run(b, async (r) => ({
      latest: await r.reportAiGenerations.listForComparison({
        promptKey: 'daily_report.generate',
        limit: 10,
      }),
      byIds: await r.reportAiGenerations.listForComparison({
        promptKey: 'daily_report.generate',
        ids: [ids.recent, ids.old],
        limit: 2,
      }),
      keywords: await r.reportAi.findKeywordsByIds(ids.keywordIds),
    }));
    expect(fromB).toEqual({ latest: [], byIds: [], keywords: [] });
  });
});
