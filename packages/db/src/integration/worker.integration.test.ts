import { formatNoticeDate, newId, outboxDedupeKey, tomorrowInTimeZone } from '@katahimo/core/domain';
import type { TenantDirectoryPort } from '@katahimo/core/ports';
import {
  FakeAppLogPort,
  FakeMailerPort,
  FakeMirrorSenderPort,
  FakeNotifierPort,
  FakeSchedulePort,
  FakeStoragePort,
  FakeWebPushSender,
} from '@katahimo/core/test-utils';
import {
  applyCustomerSnapshot,
  drainOutbox,
  runMaintenance,
  runNightlyCalendarSync,
  runRouteNoticeJob,
  saveDailyReport,
  subscribePush,
  syncStaffBusyBlocks,
  uploadReceipts,
} from '@katahimo/core/usecases';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { DrizzleAppLogRepository } from '../repositories/platform/appLog';
import { DrizzlePlatformMaintenance } from '../repositories/platform/maintenance';
import { DrizzleOutboxQueue } from '../repositories/platform/outboxQueue';
import { DrizzleTenantCalendarSettingsStore, DrizzleTenantDirectory } from '../repositories/platform/tenants';
import { DrizzleUnitOfWork } from '../uow';
import { connect, open } from './testDb';

/**
 * ワーカーのジョブを katahimo_worker の権限で実際の DB に対して動かす(ワーカーの GRANT を絞ったため、ジョブが使う
 * 表・操作が漏れていないことを確かめる)。外部サービス(カレンダー・GAS Bridge・メール・ファイル置き場)は偽物。
 */
const { app, owner, worker, uow: appUow, createTenant, createStaff, createCustomer } = connect();
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe.skipIf(!process.env.WORKER_DATABASE_URL)('ワーカーのジョブ(katahimo_worker の権限)', () => {
  const workerDb = worker as NonNullable<typeof worker>;

  it('夜間の反映・顧客の取込・翌日の予定のお知らせ・ミラーとメールと通知の送信・free/busy・保守がワーカーの権限で動く', async () => {
    const tenantId = await createTenant('wk');
    // 運用担当者が許可したカレンダーだけを読む(ワーカーは platform.tenants.calendar_settings を読める)
    await new DrizzleTenantCalendarSettingsStore(owner).set(tenantId, {
      sharedCalendars: [],
      allowedStaffCalendars: ['@cutest.co.jp'],
    });
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
        sql`insert into staff_calendars (tenant_id, id, staff_id, calendar_id, purpose) values (${tenantId}, ${newId()}, ${staffId}, 'cal-1@cutest.co.jp', 'busy')`,
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

    // ── 翌日の予定のお知らせ(購読は API が本人の端末として登録し、ジョブが積み、outbox が送る) ──
    const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };
    // outbox はテナントを横断して取り出すため、このテストの送り先はテナントの ID で見分ける
    const okEndpoint = `https://fcm.googleapis.com/fcm/send/it-ok-${tenantId}`;
    const goneEndpoint = `https://web.push.apple.com/it-gone-${tenantId}`;
    const pushDeps = { uow: appUow, appLog, pushPublicKey: 'test-vapid-public-key' };
    await subscribePush(pushDeps, actor, { endpoint: okEndpoint, ...keys });
    await subscribePush(pushDeps, actor, { endpoint: goneEndpoint, ...keys });
    const webPush = new FakeWebPushSender();
    webPush.setOutcome(goneEndpoint, { status: 'expired', statusCode: 410 });
    // 期限(明日の0時)があるため、実際の明日のお知らせで確かめる
    const tomorrow = tomorrowInTimeZone(new Date(), tenant.timezone);
    schedule.setAppointments('山田 太郎', tomorrow, [
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
        attendanceKm: '',
        leavingUrl: '',
        leavingMin: '',
        leavingKm: '',
        customerId: '',
        address: '',
      },
    ]);
    const notices = await runRouteNoticeJob({ uow: workerUow, appLog, schedule, tenants: onlyThisTenant });
    expect(notices).toMatchObject({ queued: 1, failed: 0, interrupted: false });

    // ── outbox(ミラー4種・再設定メール・Web Push) ──
    // 本番の outbox-drain と同じく接続1本のプール(DB_POOL_MAX=1)で送る。2本の接続を同時に要る処理があれば
    // ここで止まる(トランザクションの中の Promise.all はそのトランザクションの接続に並ぶだけ)
    const drainDb = open('WORKER_DATABASE_URL', 1);
    // 操作ログも本番と同じく同じプールに書く(ここでの確かめのために偽物にも写す)
    const drainAppLog = new DrizzleAppLogRepository(drainDb);
    const sender = new FakeMirrorSenderPort();
    const mailer = new FakeMailerPort();
    const drained = await drainOutbox(
      {
        queue: new DrizzleOutboxQueue(drainDb),
        uow: new DrizzleUnitOfWork(drainDb),
        storage,
        sender,
        mailer,
        appLog: {
          async write(entry) {
            await appLog.write(entry);
            await drainAppLog.write(entry);
          },
        },
        mirrorTenantSlug: tenant.slug,
        tenants: new DrizzleTenantDirectory(drainDb),
        webPush,
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
    expect(
      webPush.sent.filter((p) => p.endpoint.endsWith(tenantId)).map((p) => [p.endpoint, p.notice.title]),
    ).toEqual([[okEndpoint, `明日の予定 ${formatNoticeDate(tomorrow)} 1件`]]);
    // もう無い購読(410)はワーカーが消し、届いた購読には成功の時刻が残る
    const subscriptions = await appUow.run(tenantId, (r) => r.pushSubscriptions.listForStaff(staffId));
    expect(subscriptions).toEqual([expect.objectContaining({ endpoint: okEndpoint, failureCount: 0 })]);
    expect(subscriptions[0]?.lastSuccessAt).toBeInstanceOf(Date);

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

    // 送られないまま期限が切れた再設定コード(メール用の値は保守で消す)
    const expiredCodeId = newId();
    await appUow.run(tenantId, (r) =>
      r.passwordResetCodes.replaceActive(
        {
          id: expiredCodeId,
          staffId,
          codeHash: new Uint8Array(32),
          sentToEmail: 'taro@example.com',
          expiresAt: new Date(Date.now() - 60_000),
          maxAttempts: 5,
          mailCode: '654321',
        },
        new Date(),
      ),
    );
    const mailCodeOf = async (id: string) =>
      (
        (await withTenant(owner, tenantId, (tx) =>
          tx.execute(sql`select mail_code from password_reset_codes where id = ${id}`),
        )) as unknown as { mail_code: string | null }[]
      )[0]?.mail_code;
    expect(await mailCodeOf(expiredCodeId)).toBe('654321');

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
    expect(maintenance.tenants[0]?.deleted).toMatchObject({ password_reset_mail_codes_cleared: 1 });
    expect(await mailCodeOf(expiredCodeId)).toBeNull();
    expect(appLog.entries.filter((e) => e.level === 'ERROR')).toEqual([]);
  });
});

describe.skipIf(!process.env.WORKER_DATABASE_URL)('操作ログの既定のパーティション', () => {
  const workerDb = worker as NonNullable<typeof worker>;

  it('ワーカーは操作ログを12か月より短い保存期間で消せず、24か月より先のパーティションも作れない', async () => {
    const maintenance = new DrizzlePlatformMaintenance(workerDb);
    await expect(maintenance.dropAppLogPartitions(11)).rejects.toThrow();
    await expect(maintenance.ensureAppLogPartitions(25)).rejects.toThrow();
    await expect(maintenance.dropAppLogPartitions(12)).resolves.toBeGreaterThanOrEqual(0);
  });

  it('ワーカーのテナント横断の outbox は取り出し・状態の更新だけ(テナントの外では積めず・消せない)', async () => {
    const tenantId = await createTenant('ob');
    const messageId = newId();
    // テナントの中(app.tenant_id を設定)なら積める(夜間の反映・翌日のお知らせと同じ)。他のテストの取り出しに
    // 拾われないよう送信済みの行にする
    await withTenant(workerDb, tenantId, (tx) =>
      tx.execute(
        sql`insert into outbox_messages (tenant_id, id, topic, aggregate_type, aggregate_id, dedupe_key, status, completed_at)
            values (${tenantId}, ${messageId}, 'push.test', 'x', ${messageId}, ${`push.test:${messageId}:0`}, 'done', now())`,
      ),
    );
    // テナントを設定しない接続(取り出しと同じ)からは、見えて状態を変えられるが、消せず・積めない
    const visible = (await workerDb.execute(
      sql`select id from outbox_messages where id = ${messageId}`,
    )) as unknown as { id: string }[];
    expect(visible).toHaveLength(1);
    const updated = (await workerDb.execute(
      sql`update outbox_messages set last_error = null where id = ${messageId} returning id`,
    )) as unknown as unknown[];
    expect(updated).toHaveLength(1);
    const deleted = (await workerDb.execute(
      sql`delete from outbox_messages where id = ${messageId} returning id`,
    )) as unknown as unknown[];
    expect(deleted).toHaveLength(0);
    await expect(
      workerDb.execute(
        sql`insert into outbox_messages (tenant_id, id, topic, aggregate_type, aggregate_id, dedupe_key, status)
            values (${tenantId}, ${newId()}, 'push.test', 'x', ${newId()}, ${`push.test:${newId()}:1`}, 'done')`,
      ),
    ).rejects.toThrow();
  });

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
