import { beforeEach, describe, expect, it } from 'vitest';
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
});
