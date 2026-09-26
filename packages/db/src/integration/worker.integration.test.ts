import { newId, outboxDedupeKey } from '@katahimo/core/domain';
import type { TenantDirectoryPort } from '@katahimo/core/ports';
import {
  FakeAppLogPort,
  FakeMailerPort,
  FakeMirrorSenderPort,
  FakeNotifierPort,
  FakeSchedulePort,
  FakeStoragePort,
} from '@katahimo/core/test-utils';
import {
  applyCustomerSnapshot,
  drainOutbox,
  runMaintenance,
  runNightlyCalendarSync,
  saveDailyReport,
  syncStaffBusyBlocks,
  uploadReceipts,
} from '@katahimo/core/usecases';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { DrizzlePlatformMaintenance } from '../repositories/platform/maintenance';
import { DrizzleOutboxQueue } from '../repositories/platform/outboxQueue';
import { DrizzleTenantDirectory } from '../repositories/platform/tenants';
import { DrizzleUnitOfWork } from '../uow';
import { connect } from './testDb';

/**
 * ワーカーのジョブを katahimo_worker の権限で実際の DB に対して動かす(ワーカーの GRANT を絞ったため、ジョブが使う
 * 表・操作が漏れていないことを確かめる)。外部サービス(カレンダー・GAS Bridge・メール・ファイル置き場)は偽物。
 */
const { app, owner, worker, uow: appUow, createTenant, createStaff, createCustomer } = connect();
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe.skipIf(!process.env.WORKER_DATABASE_URL)('ワーカーのジョブ(katahimo_worker の権限)', () => {
  const workerDb = worker as NonNullable<typeof worker>;

  it('夜間の反映・顧客の取込・ミラーとメールの送信・free/busy・保守がワーカーの権限で動く', async () => {
    const tenantId = await createTenant('wk');
    const workerUow = new DrizzleUnitOfWork(workerDb);
    const tenants = new DrizzleTenantDirectory(workerDb);
    const tenant = await tenants.findById(tenantId);
    if (!tenant) throw new Error('テナントがありません');
    const appLog = new FakeAppLogPort();
    const storage = new FakeStoragePort();
    // ジョブの対象はこのテストのテナントだけ(他のテストのテナントを巻き込まない)
    const onlyThisTenant: TenantDirectoryPort = {
      findBySlug: (slug) => tenants.findBySlug(slug),
      findById: (id) => tenants.findById(id),
      listActive: async () => [tenant],
      listAll: async () => [tenant],
    };

    // ── API 側(katahimo_app)で書く: スタッフ・顧客・日報・領収書・再設定コード ──
    const { staffId, customerId } = await appUow.run(tenantId, async (r) => ({
      staffId: await createStaff(r, '山田 太郎'),
      customerId: await createCustomer(r, '佐藤 花子'),
    }));
    const actor = { tenantId, staffId, role: 'staff' as const };
    const appDeps = {
      uow: appUow,
      storage,
      notifier: new FakeNotifierPort(),
      appLog,
    };
    await saveDailyReport(appDeps, actor, {
      customerId,
      reportDate: '2026-09-24',
      startTime: '09:00',
      endTime: '12:00',
      inputText: 'メモ',
      internalText: '社内',
      customerText: '保護者',
      riskRating: 1,
      esRating: 4,
    });
    await uploadReceipts(appDeps, actor, {
      customerId,
      images: [{ data: JPEG, amount: '500', storeName: 'バス' }],
      fallbackTimestamp: '2026/09/24 09:00:00',
      handoffText: '',
    });
    const codeId = newId();
    await appUow.run(tenantId, async (r) => {
      await r.passwordResetCodes.replaceActive(
        {
          id: codeId,
          staffId,
          codeHash: new Uint8Array(32),
          sentToEmail: 'taro@example.com',
          expiresAt: new Date(Date.now() + 10 * 60_000),
          maxAttempts: 5,
          mailCode: '123456',
        },
        new Date(),
      );
      await r.outbox.enqueue({
        topic: 'mail.password_reset',
        aggregateType: 'password_reset_code',
        aggregateId: codeId,
        dedupeKey: outboxDedupeKey('mail.password_reset', codeId, 0),
      });
    });
    await withTenant(app, tenantId, (tx) =>
      tx.execute(
        sql`insert into staff_calendars (tenant_id, id, staff_id, calendar_id, purpose) values (${tenantId}, ${newId()}, ${staffId}, 'cal-1', 'busy')`,
      ),
    );

    // ── 顧客CSVの取込(顧客・住所・連絡先・子ども・取込元・import_runs・版数) ──
    const runId = newId();
    await workerUow.run(tenantId, async (r) => {
      await r.importRuns.start({
        id: runId,
        source: 'reserva_csv',
        fileName: 'Kokyaku_1.csv',
        fileVersion: '1',
        triggeredBy: null,
      });
      await applyCustomerSnapshot(
        { runId },
        r,
        {
          source: 'reserva',
          externalId: 'R-900',
          displayName: '鈴木 一郎',
          familyName: '鈴木',
          givenName: '一郎',
          memo: 'メモ',
          attributes: { member_type: '一般' },
          home: { addressLine: '東京都新宿区1-1', city: '新宿区', latLng: '35.69,139.70' },
          secondary: { addressLine: '東京都港区2-2', validFrom: '2026-10-01', validTo: '2026-10-31' },
          emergencyContact: { phone: '090-0000-0000', relation: '母' },
          recipients: [{ name: '鈴木 次郎', birthDate: '2022-04-01', allergy: '卵' }],
        },
        new Date(),
      );
      await r.settings.bumpCustomerDataVersion();
      await r.importRuns.finish(runId, { status: 'applied', counts: { created: 1 }, message: null });
    });

    // ── 夜間のカレンダー反映(勤怠の書き込み・変更履歴・outbox) ──
    const schedule = new FakeSchedulePort();
    schedule.setAppointments('山田 太郎', '2026-09-24', [
      {
        eventType: 'CUSTOMER APPOINTMENT',
        customerName: '佐藤 花子',
        startTime: '09:00',
        endTime: '12:00',
        reservaUrl: '',
        moveUrl: '',
        moveMin: '',
        moveKm: '',
        attendanceUrl: '',
        attendanceMin: '',
        attendanceKm: '3.20',
        leavingUrl: '',
        leavingMin: '',
        leavingKm: '',
        customerId: 'R-900',
        address: '',
      },
    ]);
    const nightly = await runNightlyCalendarSync(
      { uow: workerUow, appLog, schedule, tenants: onlyThisTenant },
      { date: '2026-09-24' },
    );
    expect(nightly).toMatchObject({ failed: 0, interrupted: false });
    expect(nightly.tenants[0]).toMatchObject({ succeeded: 1, changedStaffCount: 1 });

    // ── outbox(ミラー4種・再設定メール) ──
    const sender = new FakeMirrorSenderPort();
    const mailer = new FakeMailerPort();
    const drained = await drainOutbox(
      {
        queue: new DrizzleOutboxQueue(workerDb),
        uow: workerUow,
        storage,
        sender,
        mailer,
        appLog,
        mirrorEnabled: true,
        workerId: 'worker-it',
        leaseMs: 60_000,
      },
      { maxMessages: 200 },
    );
    expect(drained.failed).toBe(0);
    expect(sender.dailyReports.some((p) => p.staffName === '山田 太郎')).toBe(true);
    expect(sender.receipts.some((p) => p.storeName === 'バス')).toBe(true);
    expect(
      sender.attendanceDays.some((p) => p.businessDate === '2026-09-24' && p.staffName === '山田 太郎'),
    ).toBe(true);
    expect(sender.attendanceAggregates.some((p) => p.staffName === '山田 太郎')).toBe(true);
    expect(mailer.sent.some((m) => m.to === 'taro@example.com')).toBe(true);

    // ── free/busy の同期 ──
    const busy = await syncStaffBusyBlocks(
      {
        uow: workerUow,
        appLog,
        calendar: {
          listEvents: async () => ({ calendarName: '', events: [] }),
          freeBusy: async (ids) =>
            new Map(
              ids.map((id) => [
                id,
                {
                  busy: [{ start: new Date('2026-09-24T01:00:00Z'), end: new Date('2026-09-24T02:00:00Z') }],
                },
              ]),
            ),
        },
      },
      tenantId,
      { from: new Date('2026-09-24T00:00:00Z'), to: new Date('2026-09-25T00:00:00Z') },
      '2026-09-24',
    );
    expect(busy).toMatchObject({ syncedStaffCount: 1, failures: [] });

    // ── 保守(パーティション・保存期間の削除・参照されないファイル) ──
    const maintenance = await runMaintenance({
      uow: workerUow,
      tenants: onlyThisTenant,
      platform: new DrizzlePlatformMaintenance(workerDb),
      storage,
      appLog,
      appLogRetentionMonths: 13,
    });
    expect(maintenance).toMatchObject({ errors: [], interrupted: false });
    expect(maintenance.tenants[0]?.error).toBeUndefined();
    expect(appLog.entries.filter((e) => e.level === 'ERROR')).toEqual([]);
  });
});

describe.skipIf(!process.env.WORKER_DATABASE_URL)('操作ログの既定のパーティション', () => {
  const workerDb = worker as NonNullable<typeof worker>;

  it('月のパーティションが無い月の行は既定のパーティションが受け、保守が月のパーティションを作って移す', async () => {
    const tenantId = await createTenant('log');
    // 他のテストと重ならない遠い未来の月(保守が先回りで作る12か月より先)
    const year = 2200 + Math.floor(Math.random() * 700);
    const at = `${year}-05-15T00:00:00Z`;
    const partition = `app_logs_y${year}m05`;
    const id = newId();
    await withTenant(app, tenantId, (tx) =>
      tx.execute(
        sql`insert into app_logs (id, created_at, tenant_id, level, action, actor_type) values (${id}, ${at}::timestamptz, ${tenantId}, 'INFO', 'test.default_partition', 'system')`,
      ),
    );
    const whereIs = async () =>
      (
        (await withTenant(owner, tenantId, (tx) =>
          tx.execute(sql`select tableoid::regclass::text as part from app_logs where id = ${id}`),
        )) as unknown as { part: string }[]
      )[0]?.part;
    expect(await whereIs()).toBe('app_logs_default');
    try {
      const created = await new DrizzlePlatformMaintenance(workerDb).ensureAppLogPartitions(12);
      expect(created).toBeGreaterThanOrEqual(1);
      expect(await whereIs()).toBe(partition);
      // 移した行も親の表の RLS の中で読める(他テナントからは見えない)
      const other = await createTenant('log');
      expect(
        await withTenant(app, other, (tx) => tx.execute(sql`select 1 from app_logs where id = ${id}`)),
      ).toHaveLength(0);
    } finally {
      await owner.execute(sql.raw(`drop table if exists public.${partition}`));
    }
  });
});
