import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { CustomerDeps } from './customers';
import { createCustomer } from './customers';
import type { ReportDeps } from './reports';
import { sendVisitCompleteNotification } from './reports';
import {
  FakeCryptoPort,
  FakeCustomerRepository,
  FakeFamilyMemberRepository,
  FakeNotifierPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from './testDoubles';

describe('sendVisitCompleteNotification', () => {
  const tenantId = 'tenant-1';
  let deps: ReportDeps;
  let notifier: FakeNotifierPort;
  let staffId: string;
  let customerId: string;

  beforeEach(async () => {
    const crypto = new FakeCryptoPort();
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();
    notifier = new FakeNotifierPort();

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

    deps = {
      // このテストではDB書き込みが発生しないため未使用(型を満たすためのダミー)。
      dailyReports: {} as ReportDeps['dailyReports'],
      accidentReports: {} as ReportDeps['accidentReports'],
      customers,
      staff,
      crypto,
      notifier,
      mirror: new FakeOutboxRepository(),
    };
  });

  it('担当者名・顧客名をサーバー側で解決し、報告用チャンネルへ通知する', async () => {
    await sendVisitCompleteNotification(deps, tenantId, {
      staffId,
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
