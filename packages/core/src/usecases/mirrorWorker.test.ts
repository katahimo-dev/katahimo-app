import { beforeEach, describe, expect, it } from 'vitest';
import type { AttendanceDeps } from './attendance';
import { saveAttendanceDay } from './attendance';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import type { MirrorWorkerDeps } from './mirrorWorker';
import { runOutboxBatch } from './mirrorWorker';
import type { ReceiptDeps } from './receipts';
import { uploadReceipts } from './receipts';
import type { ReportDeps } from './reports';
import { saveAccidentReport, saveDailyReport } from './reports';
import {
  FakeAccidentReportRepository,
  FakeAttendanceDayRepository,
  FakeCryptoPort,
  FakeCustomerRepository,
  FakeDailyReportRepository,
  FakeFamilyMemberRepository,
  FakeMirrorSenderPort,
  FakeNotifierPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakeReceiptRepository,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeStoragePort,
  FakeTenantRepository,
} from './testDoubles';

describe('runOutboxBatch / processOutboxJob', () => {
  const tenantId = 'tenant-1';
  let staff: FakeStaffRepository;
  let customers: FakeCustomerRepository;
  let crypto: FakeCryptoPort;
  let outbox: FakeOutboxRepository;
  let sender: FakeMirrorSenderPort;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    crypto = new FakeCryptoPort();
    staff = new FakeStaffRepository();
    customers = new FakeCustomerRepository();
    outbox = new FakeOutboxRepository();
    sender = new FakeMirrorSenderPort();

    const authDeps: AuthDeps = {
      tenants: new FakeTenantRepository(),
      staff,
      sessions: new FakeSessionRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    const createdStaff = await registerStaff(authDeps, {
      tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      password: 'pw',
      isAdmin: false,
    });
    staffId = createdStaff.id;

    const customerDeps: CustomerDeps = {
      customers,
      familyMembers: new FakeFamilyMemberRepository(),
      crypto,
    };
    const createdCustomer = await createCustomer(customerDeps, { tenantId, name: '田中 一郎' });
    customerId = createdCustomer.id;
  });

  it('日報を保存するとoutboxに積まれ、ワーカーがGAS側へ送るペイロードに変換される', async () => {
    const dailyReports = new FakeDailyReportRepository();
    const reportDeps: ReportDeps = {
      dailyReports,
      accidentReports: new FakeAccidentReportRepository(),
      customers,
      staff,
      crypto,
      notifier: new FakeNotifierPort(),
      mirror: outbox,
    };

    const saved = await saveDailyReport(reportDeps, tenantId, {
      staffId,
      customerId,
      startTime: '09:00',
      endTime: '10:00',
      inputText: '元気に過ごした',
      internalText: '社内向けメモ',
      customerText: '保護者向けメモ',
      riskRating: 3,
      esRating: 4,
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports,
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      crypto,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(sender.dailyReports).toEqual([
      {
        reportId: saved.id,
        timestampJst: expect.any(String),
        startTime: '09:00',
        endTime: '10:00',
        staffName: '佐藤 花子',
        customerId,
        customerName: '田中 一郎',
        inputText: '元気に過ごした',
        internalText: '社内向けメモ',
        customerText: '保護者向けメモ',
        riskRating: 3,
        esRating: 4,
      },
    ]);
  });

  it('事故報告を保存するとoutboxに積まれ、ワーカーがGAS側へ送るペイロードに変換される', async () => {
    const accidentReports = new FakeAccidentReportRepository();
    const reportDeps: ReportDeps = {
      dailyReports: new FakeDailyReportRepository(),
      accidentReports,
      customers,
      staff,
      crypto,
      notifier: new FakeNotifierPort(),
      mirror: outbox,
    };

    const saved = await saveAccidentReport(reportDeps, tenantId, {
      staffId,
      customerId,
      targetName: '田中 太郎',
      targetDob: '2020/01/01',
      occurrenceTime: '14:00',
      location: '公園',
      accidentContent: '転倒した',
      situation: '走っていて転んだ',
      immediateResponse: '患部を冷やした',
      parentCorrespondence: '電話で報告済み',
      diagnosisTreatment: '受診の必要なし',
      prevention: '注意して見守る',
      inputText: '元の入力',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports,
      receipts: new FakeReceiptRepository(),
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      crypto,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(sender.accidentReports).toHaveLength(1);
    expect(sender.accidentReports[0]).toMatchObject({
      reportId: saved.id,
      staffName: '佐藤 花子',
      customerName: '田中 一郎',
      targetName: '田中 太郎',
      reportType: '事故報告',
    });
  });

  it('領収書をアップロードするとoutboxに積まれ、ワーカーが画像データURLに変換して送る', async () => {
    const receipts = new FakeReceiptRepository();
    const storage = new FakeStoragePort();
    const receiptDeps: ReceiptDeps = {
      receipts,
      staff,
      customers,
      crypto,
      blindIndex: {
        async compute(_tenantId: string, normalizedValue: string) {
          return `blind:${normalizedValue}`;
        },
      },
      storage,
      notifier: new FakeNotifierPort(),
      mirror: outbox,
    };

    await uploadReceipts(receiptDeps, tenantId, {
      staffId,
      customerId,
      images: [
        {
          data: 'data:image/jpeg;base64,AAAA',
          amount: '1200',
          storeName: 'コンビニ',
        },
      ],
      fallbackTimestamp: '2026/08/30 10:00:00',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts,
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      crypto,
      storage,
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(sender.receipts).toHaveLength(1);
    expect(sender.receipts[0]).toMatchObject({
      staffName: '佐藤 花子',
      customerName: '田中 一郎',
      amount: '1200',
      storeName: 'コンビニ',
      imageDataUrl: 'data:image/jpeg;base64,AAAA',
    });
  });

  it('勤怠(出勤簿)を保存するとoutboxに積まれ、ワーカーが列記号をキーにした値に変換して送る', async () => {
    const attendanceDays = new FakeAttendanceDayRepository();
    const attendanceDeps: AttendanceDeps = { attendanceDays, crypto, mirror: outbox };

    await saveAttendanceDay(attendanceDeps, tenantId, staffId, '2026-08-30', {
      C: '訪問先A',
      D: '09:00',
      E: '10:00',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays,
      staff,
      customers,
      crypto,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(sender.attendanceDays).toEqual([
      {
        staffName: '佐藤 花子',
        businessDate: '2026-08-30',
        values: { C: '訪問先A', D: '09:00', E: '10:00' },
      },
    ]);
  });

  it('対象レコードが既に無い場合は何もせず成功扱いにする', async () => {
    await outbox.enqueue({
      tenantId,
      kind: 'daily_report',
      targetId: 'missing-report',
      idempotencyKey: 'idem-1',
    });

    const workerDeps: MirrorWorkerDeps = {
      outbox,
      dailyReports: new FakeDailyReportRepository(),
      accidentReports: new FakeAccidentReportRepository(),
      receipts: new FakeReceiptRepository(),
      attendanceDays: new FakeAttendanceDayRepository(),
      staff,
      customers,
      crypto,
      storage: new FakeStoragePort(),
      sender,
    };
    const result = await runOutboxBatch(workerDeps, tenantId);

    expect(result).toEqual({ processed: 1, failed: 0 });
    expect(sender.dailyReports).toEqual([]);
  });
});
