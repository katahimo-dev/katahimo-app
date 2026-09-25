import { beforeEach, describe, expect, it } from 'vitest';
import { registerStaff } from './auth';
import { createCustomer } from './customers';
import type { ReportDeps, SaveDailyReportInput } from './reports';
import { saveAccidentReport, saveDailyReport, sendVisitCompleteNotification } from './reports';
import {
  FakeAccidentReportRepository,
  FakeAppLogPort,
  FakeCryptoPort,
  FakeCustomerRepository,
  FakeDailyReportRepository,
  FakeFamilyMemberRepository,
  FakeNotifierPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakeStaffRepository,
} from './testDoubles';

describe('日報/事故報告の保存', () => {
  const tenantId = 'tenant-1';
  let deps: ReportDeps;
  let notifier: FakeNotifierPort;
  let appLog: FakeAppLogPort;
  let hanakoId: string;
  let jiroId: string;
  let adminId: string;
  let customerId: string;

  const dailyInput = (overrides: Partial<SaveDailyReportInput> = {}): SaveDailyReportInput => ({
    actor: { staffId: hanakoId, isAdmin: false },
    customerId,
    startTime: '09:00',
    endTime: '10:00',
    inputText: 'メモ',
    internalText: '社内向け',
    customerText: '保護者向け',
    riskRating: 4,
    esRating: null,
    ...overrides,
  });

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();
    const crypto = new FakeCryptoPort();
    notifier = new FakeNotifierPort();
    appLog = new FakeAppLogPort();
    const hasher = new FakePasswordHasherPort();
    const reg = (name: string, email: string, isAdmin: boolean) =>
      registerStaff({ staff, passwordHasher: hasher }, { tenantId, name, email, password: 'pw', isAdmin });
    hanakoId = (await reg('佐藤 花子', 'hanako@example.com', false)).id;
    jiroId = (await reg('鈴木 次郎', 'jiro@example.com', false)).id;
    adminId = (await reg('管理者 太郎', 'admin@example.com', true)).id;
    customerId = (
      await createCustomer(
        { customers, familyMembers: new FakeFamilyMemberRepository(), crypto },
        {
          tenantId,
          name: '田中 一郎',
        },
      )
    ).id;
    deps = {
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      customers,
      staff,
      crypto,
      notifier,
      mirror: new FakeOutboxRepository(),
      appLog,
    };
  });

  it('管理者以外が他スタッフの名義を指定しても、本人の日報として保存される', async () => {
    const result = await saveDailyReport(deps, tenantId, dailyInput({ requestedStaffId: jiroId }));
    expect(result.ok && result.report.staffId).toBe(hanakoId);
    expect(appLog.entries.at(-1)).toMatchObject({
      level: 'INFO',
      action: 'report.daily.saved',
      targetStaffId: null,
    });
  });

  it('管理者以外は他スタッフの日報を上書きできない(GAS版の上書きの穴を塞ぐ)', async () => {
    const jiroReport = await saveDailyReport(
      deps,
      tenantId,
      dailyInput({ actor: { staffId: jiroId, isAdmin: false } }),
    );
    if (!jiroReport.ok) throw new Error('unreachable');

    const result = await saveDailyReport(deps, tenantId, dailyInput({ reportId: jiroReport.report.id }));
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'report.daily.save_denied',
      actorStaffId: hanakoId,
      targetStaffId: jiroId,
    });
    const stored = await deps.dailyReports.findById(tenantId, jiroReport.report.id);
    expect(stored?.staffId).toBe(jiroId);
  });

  it('本人は自分の日報を上書きできる', async () => {
    const first = await saveDailyReport(deps, tenantId, dailyInput());
    if (!first.ok) throw new Error('unreachable');
    const second = await saveDailyReport(
      deps,
      tenantId,
      dailyInput({ reportId: first.report.id, internalText: '修正' }),
    );
    expect(second.ok && second.report.id).toBe(first.report.id);
    expect(second.ok && second.report.content.internalText).toBe('修正');
  });

  it('管理者は他スタッフの日報を上書きでき、担当者は元の担当者のまま(明示指定が無い場合)', async () => {
    const jiroReport = await saveDailyReport(
      deps,
      tenantId,
      dailyInput({ actor: { staffId: jiroId, isAdmin: false } }),
    );
    if (!jiroReport.ok) throw new Error('unreachable');
    const result = await saveDailyReport(
      deps,
      tenantId,
      dailyInput({ actor: { staffId: adminId, isAdmin: true }, reportId: jiroReport.report.id }),
    );
    expect(result.ok && result.report.staffId).toBe(jiroId);
    expect(appLog.entries.at(-1)).toMatchObject({ actorStaffId: adminId, targetStaffId: jiroId });
  });

  it('管理者は他スタッフ名義で新規保存できる', async () => {
    const result = await saveDailyReport(
      deps,
      tenantId,
      dailyInput({ actor: { staffId: adminId, isAdmin: true }, requestedStaffId: jiroId }),
    );
    expect(result.ok && result.report.staffId).toBe(jiroId);
    expect(notifier.notifications[0]?.text).toContain('担当: 鈴木 次郎');
  });

  it('存在しない日報IDの上書き・存在しない顧客は保存せずエラーにする', async () => {
    expect(await saveDailyReport(deps, tenantId, dailyInput({ reportId: 'no-such' }))).toEqual({
      ok: false,
      reason: 'report_not_found',
    });
    expect(await saveDailyReport(deps, tenantId, dailyInput({ customerId: 'no-such' }))).toEqual({
      ok: false,
      reason: 'customer_not_found',
    });
    expect(notifier.notifications).toEqual([]);
  });

  it('事故報告も管理者以外は他スタッフの報告を上書きできない', async () => {
    const base = {
      customerId,
      reportType: 'ヒヤリハット',
      targetName: '',
      targetDob: '',
      occurrenceTime: '',
      location: '',
      accidentContent: '',
      situation: '',
      immediateResponse: '',
      parentCorrespondence: '',
      diagnosisTreatment: '',
      prevention: '',
      inputText: '',
    };
    const jiroReport = await saveAccidentReport(deps, tenantId, {
      ...base,
      actor: { staffId: jiroId, isAdmin: false },
    });
    if (!jiroReport.ok) throw new Error('unreachable');
    expect(jiroReport.report.reportType).toBe('ヒヤリハット');
    expect(notifier.notifications[0]?.text.startsWith('【ヒヤリハット】')).toBe(true);

    const result = await saveAccidentReport(deps, tenantId, {
      ...base,
      actor: { staffId: hanakoId, isAdmin: false },
      reportId: jiroReport.report.id,
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('Google Chat未設定・送信失敗はアプリログ(WARN/ERROR)に残し、保存自体は成功させる', async () => {
    notifier.result = { status: 'not_configured' };
    expect((await saveDailyReport(deps, tenantId, dailyInput())).ok).toBe(true);
    expect(appLog.entries).toContainEqual(
      expect.objectContaining({ level: 'WARN', action: 'notification.gchat.not_configured' }),
    );

    notifier.result = { status: 'failed', httpStatus: 500, error: 'Internal' };
    expect((await saveDailyReport(deps, tenantId, dailyInput())).ok).toBe(true);
    expect(appLog.entries).toContainEqual(
      expect.objectContaining({ level: 'ERROR', action: 'notification.gchat.failed' }),
    );
  });

  it('訪問完了通知は担当者名・顧客名をサーバー側で解決して送る', async () => {
    await sendVisitCompleteNotification(deps, tenantId, {
      staffId: hanakoId,
      customerId,
      visitDate: '2026-08-28',
      startTime: '09:00',
      endTime: '11:00',
    });
    expect(notifier.notifications).toEqual([
      {
        tenantId,
        channel: 'report',
        text: '【訪問完了】\n担当: 佐藤 花子\n顧客名: 田中 一郎\n訪問日時: 2026/08/28 09:00〜11:00',
      },
    ]);
  });
});
