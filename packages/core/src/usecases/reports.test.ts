import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveDailyReportInput } from './reports';
import {
  getCustomerHistory,
  saveAccidentReport,
  saveDailyReport,
  sendVisitCompleteNotification,
} from './reports';
import type { Actor } from './requestMeta';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

describe('保育日報・事故報告', () => {
  let ctx: TestContext;
  let staff: Actor;
  let other: Actor;
  let admin: Actor;
  let customerId: string;
  let otherCustomerId: string;

  const daily = (overrides: Partial<SaveDailyReportInput> = {}): SaveDailyReportInput => ({
    customerId,
    reportDate: '2026-09-25',
    startTime: '09:00',
    endTime: '12:00',
    inputText: 'メモ',
    internalText: '社内向け',
    customerText: '保護者向け',
    riskRating: 4,
    esRating: 4,
    ...overrides,
  });

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    customerId = await ctx.addCustomer('佐藤 花子');
    otherCustomerId = await ctx.addCustomer('田中 一郎');
  });

  it('本文を保存し、ミラーを同じトランザクションで積み、保存後に通知する', async () => {
    const saved = await saveDailyReport(ctx.deps, staff, daily());
    const row = ctx.data().careRecords[0];
    expect(row?.body).toMatchObject({ inputText: 'メモ' });
    expect(row?.occurredAt.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(row?.retainUntil).toBe('2031-09-24');
    expect(ctx.data().outbox.map((m) => m.dedupeKey)).toEqual([`mirror.care_record:${saved.id}:1`]);
    expect(ctx.notifier.notifications).toHaveLength(1);
    expect(saved.rowVersion).toBe(1);
  });

  it('通知が例外を投げても保存は成功する(通知は保存の成否に関わらない)', async () => {
    ctx.notifier.notify = async () => {
      throw new Error('送信先を解決できません');
    };
    const saved = await saveDailyReport(ctx.deps, staff, daily());
    expect(ctx.data().careRecords.map((r) => r.id)).toEqual([saved.id]);
    expect(ctx.appLog.actions()).toContain('notification.gchat.failed');
  });

  it('一般スタッフが他人の名義を指定しても本人の名義で保存する', async () => {
    const saved = await saveDailyReport(ctx.deps, staff, daily({ requestedStaffId: other.staffId }));
    expect(saved.staffId).toBe(staff.staffId);
  });

  it('管理者は他のスタッフの名義で保存できる', async () => {
    const saved = await saveDailyReport(ctx.deps, admin, daily({ requestedStaffId: other.staffId }));
    expect(saved.staffId).toBe(other.staffId);
  });

  it('一般スタッフは他人の報告を上書きできない(forbidden、SECURITY ログ)', async () => {
    const saved = await saveDailyReport(ctx.deps, other, daily());
    await expect(saveDailyReport(ctx.deps, staff, daily({ reportId: saved.id }))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(ctx.appLog.byAction('report.daily.save_denied')[0]?.level).toBe('SECURITY');
  });

  it('上書きで顧客・担当スタッフは変えられない(409 conflict)', async () => {
    const saved = await saveDailyReport(ctx.deps, admin, daily({ requestedStaffId: other.staffId }));
    await expect(
      saveDailyReport(ctx.deps, admin, daily({ reportId: saved.id, customerId: otherCustomerId })),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'customer_mismatch' });
    await expect(
      saveDailyReport(ctx.deps, admin, daily({ reportId: saved.id, requestedStaffId: staff.staffId })),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'author_mismatch' });
  });

  it('上書きは版を確かめ(古い版なら 409)、変更前の本文を履歴に残し、ミラーを版ごとに積む', async () => {
    const saved = await saveDailyReport(ctx.deps, staff, daily());
    const updated = await saveDailyReport(
      ctx.deps,
      staff,
      daily({ reportId: saved.id, rowVersion: 1, inputText: '修正' }),
    );
    expect(updated.rowVersion).toBe(2);
    expect(ctx.data().careRecordRevisions).toHaveLength(1);
    await expect(
      saveDailyReport(ctx.deps, staff, daily({ reportId: saved.id, rowVersion: 1, inputText: '古い画面' })),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(ctx.data().outbox.map((m) => m.dedupeKey)).toEqual([
      `mirror.care_record:${saved.id}:1`,
      `mirror.care_record:${saved.id}:2`,
    ]);
  });

  it('事故報告とヒヤリハットは上書きで切り替えられる(GAS版と同じ)。記録は1件のまま', async () => {
    const base = {
      customerId,
      reportType: '事故報告',
      targetName: '佐藤 一郎',
      targetDob: '2022/4/1',
      occurrenceTime: '10:00',
      location: '公園',
      accidentContent: '転倒',
      situation: '走っていた',
      immediateResponse: '冷やした',
      parentCorrespondence: '報告済み',
      diagnosisTreatment: 'なし',
      prevention: '見守り',
      inputText: 'メモ',
    };
    const saved = await saveAccidentReport(ctx.deps, staff, base);
    expect(saved.reportType).toBe('事故報告');
    const switched = await saveAccidentReport(ctx.deps, staff, {
      ...base,
      reportId: saved.id,
      reportType: 'ヒヤリハット',
      rowVersion: saved.rowVersion,
    });
    expect(switched).toMatchObject({ id: saved.id, reportType: 'ヒヤリハット' });
    expect(ctx.data().careRecords).toEqual([
      expect.objectContaining({ id: saved.id, recordType: 'near_miss' }),
    ]);
    const back = await saveAccidentReport(ctx.deps, staff, { ...base, reportId: saved.id });
    expect(back.reportType).toBe('事故報告');
  });

  it('活動記録はキーセットで重複・抜け無くページングできる(同じ時刻の記録を含む)', async () => {
    for (let i = 0; i < 7; i++) {
      await saveDailyReport(ctx.deps, staff, daily({ reportDate: i < 3 ? '2026-09-20' : `2026-09-2${i}` }));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await getCustomerHistory(ctx.deps, staff, customerId, cursor, 3);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    await expect(getCustomerHistory(ctx.deps, staff, customerId, 'garbage', 3)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('訪問完了の通知は DB の名前を使う', async () => {
    await sendVisitCompleteNotification(ctx.deps, staff, {
      customerId,
      visitDate: '2026-09-25',
      startTime: '09:00',
      endTime: '12:00',
    });
    expect(ctx.notifier.notifications[0]?.text).toBe(
      '【訪問完了】\n担当: 山田 太郎\n顧客名: 佐藤 花子\n訪問日時: 2026/09/25 09:00〜12:00',
    );
  });

  describe('日報AI: 対象のお子様・AI 生成の記録・PSI の知らせ', () => {
    const generation = (overrides: Record<string, unknown> = {}) => ({
      id: '00000000-0000-7000-8000-0000000000e1',
      staffId: staff.staffId,
      customerId,
      careRecipientId: null,
      promptKey: 'daily_report.generate',
      promptRevision: 3,
      defaultPromptSha256: null,
      appVersion: null,
      model: 'gemini-test',
      promptText: 'p',
      inputText: 'i',
      timeInfo: 't',
      startedAt: new Date('2026-09-25T02:00:00Z'),
      finishedAt: new Date('2026-09-25T02:00:01Z'),
      childAgeMonths: null,
      educationLevel: 2,
      effectiveEducationLevel: 2,
      riskRating: 4,
      escalationRequired: false,
      candidateKeywordIds: [],
      usedKeywordIds: [],
      unresolvedUsedCodes: [],
      output: { warnings: [] },
      errorCode: null,
      ...overrides,
    });
    const addGeneration = (overrides: Record<string, unknown> = {}) =>
      ctx.uow.run(ctx.tenantId, (r) => r.reportAiGenerations.insert(generation(overrides) as never));

    it('AI 生成の記録を日報に結び付け、上書きしても前の生成は結び付いたまま', async () => {
      await addGeneration();
      const saved = await saveDailyReport(
        ctx.deps,
        staff,
        daily({ aiGenerationId: '00000000-0000-7000-8000-0000000000e1' }),
      );
      expect(ctx.data().reportAiGenerations[0]?.careRecordId).toBe(saved.id);
      await addGeneration({ id: '00000000-0000-7000-8000-0000000000e2' });
      await saveDailyReport(
        ctx.deps,
        staff,
        daily({ reportId: saved.id, aiGenerationId: '00000000-0000-7000-8000-0000000000e2' }),
      );
      // 同じ日報の保存し直しは同じ生成でもよい
      await saveDailyReport(
        ctx.deps,
        staff,
        daily({ reportId: saved.id, aiGenerationId: '00000000-0000-7000-8000-0000000000e2' }),
      );
      expect(ctx.data().reportAiGenerations.map((g) => g.careRecordId)).toEqual([saved.id, saved.id]);
    });

    it('他のスタッフ・他のお客様・失敗した生成・別の日報に結び付いた生成は結び付けない', async () => {
      await addGeneration();
      await addGeneration({ id: '00000000-0000-7000-8000-0000000000e3', customerId: otherCustomerId });
      await addGeneration({
        id: '00000000-0000-7000-8000-0000000000e4',
        output: null,
        errorCode: 'api_error',
      });
      await expect(
        saveDailyReport(ctx.deps, other, daily({ aiGenerationId: '00000000-0000-7000-8000-0000000000e1' })),
      ).rejects.toMatchObject({ code: 'validation_failed', reason: 'ai_generation_mismatch' });
      for (const id of ['00000000-0000-7000-8000-0000000000e3', '00000000-0000-7000-8000-0000000000e4']) {
        await expect(saveDailyReport(ctx.deps, staff, daily({ aiGenerationId: id }))).rejects.toMatchObject({
          reason: 'ai_generation_mismatch',
        });
      }
      await saveDailyReport(
        ctx.deps,
        staff,
        daily({ aiGenerationId: '00000000-0000-7000-8000-0000000000e1' }),
      );
      await expect(
        saveDailyReport(ctx.deps, staff, daily({ aiGenerationId: '00000000-0000-7000-8000-0000000000e1' })),
      ).rejects.toMatchObject({ code: 'conflict', reason: 'ai_generation_linked' });
      expect(ctx.data().careRecords).toHaveLength(1);
    });

    it('読んだ後に別の日報に結び付いた生成は、結び付けずに保存ごと戻す(並んだ2つの保存)', async () => {
      await addGeneration();
      const first = await saveDailyReport(
        ctx.deps,
        staff,
        daily({ aiGenerationId: '00000000-0000-7000-8000-0000000000e1' }),
      );
      // 2つ目の保存は、1つ目が結び付ける前に生成の記録を読んだ(まだ結び付いていないように見える)
      const run = ctx.uow.run.bind(ctx.uow);
      vi.spyOn(ctx.uow, 'run').mockImplementationOnce((tenantId, work) =>
        run(tenantId, (r) =>
          work({
            ...r,
            reportAiGenerations: {
              ...r.reportAiGenerations,
              findById: async (id) => {
                const g = await r.reportAiGenerations.findById(id);
                return g ? { ...g, careRecordId: null } : null;
              },
            },
          }),
        ),
      );
      await expect(
        saveDailyReport(ctx.deps, staff, daily({ aiGenerationId: '00000000-0000-7000-8000-0000000000e1' })),
      ).rejects.toMatchObject({ code: 'conflict', reason: 'ai_generation_linked' });
      expect(ctx.data().careRecords).toHaveLength(1);
      expect(ctx.data().reportAiGenerations[0]?.careRecordId).toBe(first.id);
    });

    it('対象のお子様はお客様の世帯の子だけ保存できる', async () => {
      const withChild = await ctx.addCustomer('高橋 三郎', 'C3', [
        { name: 'さくら', birthDate: '2024-04-01' },
      ]);
      const child = ctx.data().recipients.find((c) => c.customerId === withChild)?.id as string;
      const saved = await saveDailyReport(
        ctx.deps,
        staff,
        daily({ customerId: withChild, careRecipientId: child }),
      );
      expect(saved.careRecipientId).toBe(child);
      expect(ctx.data().careRecords[0]?.careRecipientId).toBe(child);
      await expect(saveDailyReport(ctx.deps, staff, daily({ careRecipientId: child }))).rejects.toMatchObject(
        {
          code: 'validation_failed',
          reason: 'care_recipient_mismatch',
        },
      );
    });

    it('対象のお子様を省略すると世帯の子が1人ならその子、null は選ばない(画面の自動選択と同じ)', async () => {
      const one = await ctx.addCustomer('高橋 三郎', 'C3', [{ name: 'さくら', birthDate: '2024-04-01' }]);
      const two = await ctx.addCustomer('伊藤 四郎', 'C4', [
        { name: 'あお', birthDate: '2023-04-01' },
        { name: 'みどり', birthDate: '2025-04-01' },
      ]);
      const child = ctx.data().recipients.find((c) => c.customerId === one)?.id as string;
      expect((await saveDailyReport(ctx.deps, staff, daily({ customerId: one }))).careRecipientId).toBe(
        child,
      );
      expect(
        (await saveDailyReport(ctx.deps, staff, daily({ customerId: one, careRecipientId: null })))
          .careRecipientId,
      ).toBeNull();
      expect((await saveDailyReport(ctx.deps, staff, daily({ customerId: two }))).careRecipientId).toBeNull();
    });

    it('PSI 2 以下の新しい日報・PSI が変わった保存は管理者の全ての端末に Web Push を積み、Google Chat にも知らせる', async () => {
      const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
      await ctx.uow.run(ctx.tenantId, async (r) => {
        await r.pushSubscriptions.upsert({
          id: '00000000-0000-7000-8000-00000000f001',
          staffId: admin.staffId,
          endpoint: 'https://push.example/a1',
          userAgent: null,
          ...keys,
        });
        await r.pushSubscriptions.upsert({
          id: '00000000-0000-7000-8000-00000000f002',
          staffId: admin.staffId,
          endpoint: 'https://push.example/a2',
          userAgent: null,
          ...keys,
        });
        await r.pushSubscriptions.upsert({
          id: '00000000-0000-7000-8000-00000000f003',
          staffId: staff.staffId,
          endpoint: 'https://push.example/s1',
          userAgent: null,
          ...keys,
        });
      });
      const saved = await saveDailyReport(ctx.deps, staff, daily({ riskRating: 1 }));
      expect(saved.psiAlert).toBe(true);
      const pushes = ctx.data().outbox.filter((m) => m.topic === 'push.psi_alert');
      expect(pushes.map((m) => m.dedupeKey).sort()).toEqual([
        `push.psi_alert:00000000-0000-7000-8000-00000000f001:${saved.id}:1`,
        `push.psi_alert:00000000-0000-7000-8000-00000000f002:${saved.id}:1`,
      ]);
      expect(pushes[0]?.payload).toMatchObject({
        staffId: admin.staffId,
        notice: { title: '🚨 PSI 1（危険・緊急）の日報', url: '/' },
      });
      expect(JSON.stringify(pushes[0]?.payload)).not.toContain('社内向け');
      expect(ctx.notifier.notifications.map((n) => n.text.split('\n')[0])).toEqual([
        '【日報提出】',
        '【PSI緊急】PSI 1（危険・緊急）の日報が保存されました',
      ]);
      expect(ctx.appLog.byAction('report.psi_alert')[0]).toMatchObject({
        level: 'WARN',
        details: { reportId: saved.id, riskRating: 1, pushQueued: 2 },
      });
      // 同じ PSI のまま保存し直しても(文面の手直し等)知らせない(Web Push・Google Chat・操作ログ・画面の案内)
      const resaved = await saveDailyReport(ctx.deps, staff, daily({ reportId: saved.id, riskRating: 1 }));
      expect(resaved.psiAlert).toBe(false);
      expect(ctx.data().outbox.filter((m) => m.topic === 'push.psi_alert')).toHaveLength(2);
      expect(ctx.notifier.notifications.filter((n) => n.text.startsWith('【PSI'))).toHaveLength(1);
      expect(ctx.appLog.byAction('report.psi_alert')).toHaveLength(1);
      // PSI が変われば(2 以下のまま)もう一度知らせる。PSI 3 以上なら知らせない
      const changed = await saveDailyReport(ctx.deps, staff, daily({ reportId: saved.id, riskRating: 2 }));
      expect(changed.psiAlert).toBe(true);
      expect(
        ctx
          .data()
          .outbox.filter((m) => m.topic === 'push.psi_alert')
          .map((m) => m.dedupeKey)
          .filter((k) => k.endsWith(`:${saved.id}:2`)),
      ).toHaveLength(2);
      const calm = await saveDailyReport(ctx.deps, staff, daily({ reportId: saved.id, riskRating: 3 }));
      expect(calm.psiAlert).toBe(false);
      expect(ctx.data().outbox.filter((m) => m.topic === 'push.psi_alert')).toHaveLength(4);
      expect(ctx.notifier.notifications.filter((n) => n.text.startsWith('【PSI'))).toHaveLength(2);
      expect(ctx.appLog.byAction('report.psi_alert')).toHaveLength(2);
    });
  });
});
