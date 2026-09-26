import { beforeEach, describe, expect, it } from 'vitest';
import { zonedBusinessDate } from '../domain';
import type { ScheduleAppointmentWithRoute } from '../ports/schedule';
import { processNextOutboxMessage } from './outboxWorker';
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_STAFF,
  PUSH_DISABLED_MESSAGE,
  PUSH_NOT_SUBSCRIBED_MESSAGE,
  PUSH_REJECTION_LIMIT,
  pushConfigOf,
  runRouteNoticeJob,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from './pushNotifications';
import type { Actor } from './requestMeta';
import { updateStaffByAdmin } from './staffAdmin';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

const ENDPOINT_A = 'https://fcm.googleapis.com/fcm/send/device-a';
const ENDPOINT_B = 'https://web.push.apple.com/device-b';
const keys = { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) };

const appointment = (
  customerName: string,
  startTime: string,
  endTime: string,
): ScheduleAppointmentWithRoute => ({
  eventType: 'CUSTOMER APPOINTMENT',
  customerName,
  startTime,
  endTime,
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
  address: '東京都渋谷区1-2-3',
});

describe('Web Push の購読', () => {
  let ctx: TestContext;
  let taro: Actor;
  let hanako: Actor;

  beforeEach(async () => {
    ctx = createTestContext();
    taro = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    hanako = (await ctx.addStaff('佐藤 花子', 'hanako@example.com')).actor;
  });

  it('VAPID の公開鍵があれば使える', () => {
    expect(pushConfigOf(ctx.deps)).toEqual({ enabled: true, publicKey: 'test-vapid-public-key' });
    expect(pushConfigOf({ pushPublicKey: null })).toEqual({ enabled: false, publicKey: null });
  });

  it('登録し直しても1行のまま、鍵を書き直す。ログに endpoint を残さない', async () => {
    await subscribePush(
      ctx.deps,
      { ...taro, meta: { userAgent: 'iPhone' } },
      { endpoint: ENDPOINT_A, ...keys },
    );
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, p256dh: 'q'.repeat(87), auth: keys.auth });
    expect(ctx.data().pushSubscriptions).toEqual([
      expect.objectContaining({ staffId: taro.staffId, endpoint: ENDPOINT_A, p256dh: 'q'.repeat(87) }),
    ]);
    const logs = ctx.appLog.byAction('push.subscription.saved');
    expect(logs.map((l) => l.details?.created)).toEqual([true, false]);
    expect(JSON.stringify(logs)).not.toContain('device-a');
  });

  it('同じ端末で別のスタッフが登録したら、そのスタッフの購読に付け替える', async () => {
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await subscribePush(ctx.deps, hanako, { endpoint: ENDPOINT_A, ...keys });
    expect(ctx.data().pushSubscriptions.map((p) => p.staffId)).toEqual([hanako.staffId]);
    expect(ctx.appLog.byAction('push.subscription.saved').at(-1)?.details).toMatchObject({
      created: false,
      previousStaffId: taro.staffId,
    });
  });

  it('購読をやめられるのは本人の購読だけ', async () => {
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await unsubscribePush(ctx.deps, hanako, ENDPOINT_A);
    expect(ctx.data().pushSubscriptions).toHaveLength(1);
    await unsubscribePush(ctx.deps, taro, ENDPOINT_A);
    expect(ctx.data().pushSubscriptions).toEqual([]);
    expect(ctx.appLog.byAction('push.subscription.deleted').map((l) => l.details?.deleted)).toEqual([
      false,
      true,
    ]);
  });

  it('VAPID の設定が無ければ登録・テスト通知は断る', async () => {
    const deps = { ...ctx.deps, pushPublicKey: null };
    await expect(subscribePush(deps, taro, { endpoint: ENDPOINT_A, ...keys })).rejects.toMatchObject({
      code: 'validation_failed',
      message: PUSH_DISABLED_MESSAGE,
    });
    await expect(sendTestPush(deps, taro)).rejects.toMatchObject({ message: PUSH_DISABLED_MESSAGE });
  });

  it(`1人の購読は ${MAX_PUSH_SUBSCRIPTIONS_PER_STAFF} 件まで(超えたら最近使っていないものから消す)`, async () => {
    for (let i = 0; i <= MAX_PUSH_SUBSCRIPTIONS_PER_STAFF; i++) {
      await subscribePush(ctx.deps, taro, { endpoint: `${ENDPOINT_A}-${i}`, ...keys });
    }
    // 最初の端末を登録し直すと新しい扱いになり、2番目が消える
    await subscribePush(ctx.deps, taro, { endpoint: `${ENDPOINT_A}-1`, ...keys });
    await subscribePush(ctx.deps, taro, { endpoint: `${ENDPOINT_A}-extra`, ...keys });
    const endpoints = ctx.data().pushSubscriptions.map((p) => p.endpoint);
    expect(endpoints).toHaveLength(MAX_PUSH_SUBSCRIPTIONS_PER_STAFF);
    expect(endpoints).not.toContain(`${ENDPOINT_A}-0`);
    expect(endpoints).not.toContain(`${ENDPOINT_A}-2`);
    expect(endpoints).toContain(`${ENDPOINT_A}-1`);
    expect(ctx.appLog.byAction('push.subscription.saved').at(-1)?.details).toMatchObject({ trimmed: 1 });
  });

  it('退職日(今日以前)を入れると、そのスタッフの購読を全て消す(先の日付なら残す)', async () => {
    const admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await subscribePush(ctx.deps, hanako, { endpoint: ENDPOINT_B, ...keys });
    await updateStaffByAdmin(ctx.deps, admin, taro.staffId, { retiredOn: '2999-12-31' });
    expect(ctx.data().pushSubscriptions).toHaveLength(2);
    const retiredToday = zonedBusinessDate(ctx.clock.now, 'Asia/Tokyo');
    await updateStaffByAdmin(ctx.deps, admin, taro.staffId, { retiredOn: retiredToday });
    expect(ctx.data().pushSubscriptions.map((p) => p.staffId)).toEqual([hanako.staffId]);
  });

  it('テスト通知は本人の全ての端末に送る(購読が無ければ断る)', async () => {
    await expect(sendTestPush(ctx.deps, taro)).rejects.toMatchObject({
      message: PUSH_NOT_SUBSCRIBED_MESSAGE,
    });
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_B, ...keys });
    await subscribePush(ctx.deps, hanako, { endpoint: 'https://fcm.googleapis.com/fcm/send/other', ...keys });
    expect(await sendTestPush(ctx.deps, taro)).toEqual({ subscriptionCount: 2 });
    expect(await sendTestPush(ctx.deps, taro)).toEqual({ subscriptionCount: 2 });
    // 押すたびに、端末ごとに1件ずつ積む
    expect(ctx.data().outbox.filter((m) => m.topic === 'push.test')).toHaveLength(4);
    expect(await ctx.drain()).toMatchObject({ done: 4 });
    expect(ctx.webPush.sent.map((s) => s.endpoint).sort()).toEqual(
      [ENDPOINT_B, ENDPOINT_A, ENDPOINT_B, ENDPOINT_A].sort(),
    );
    expect(ctx.webPush.sent[0]?.notice.title).toBe('テスト通知');
  });
});

describe('Web Push の送信(outbox)', () => {
  let ctx: TestContext;
  let taro: Actor;

  const messageFor = (endpoint: string) => {
    const subscription = ctx.data().pushSubscriptions.find((p) => p.endpoint === endpoint);
    return ctx.data().outbox.find((m) => m.aggregateId === subscription?.id);
  };

  beforeEach(async () => {
    ctx = createTestContext({ now: '2026-09-26T10:00:00Z' });
    taro = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_B, ...keys });
  });

  it('端末ごとに1件ずつ送り、受け付けられたら最後の成功時刻を残す', async () => {
    await sendTestPush(ctx.deps, taro);
    expect(await ctx.drain()).toMatchObject({ done: 2 });
    expect(ctx.data().pushSubscriptions.map((p) => p.lastSuccessAt)).toEqual([ctx.clock.now, ctx.clock.now]);
    // TTL は期限(テストは1時間)までの残り
    expect(ctx.webPush.sent.map((s) => s.options.ttlSeconds)).toEqual([3600, 3600]);
  });

  it('410 Gone(購読がもう無い)の購読は消し、他の端末には送る', async () => {
    ctx.webPush.setOutcome(ENDPOINT_A, { status: 'expired', statusCode: 410 });
    await sendTestPush(ctx.deps, taro);
    expect(await ctx.drain()).toMatchObject({ done: 2 });
    expect(ctx.data().pushSubscriptions.map((p) => p.endpoint)).toEqual([ENDPOINT_B]);
    expect(ctx.webPush.sent.map((s) => s.endpoint)).toEqual([ENDPOINT_B]);
    expect(ctx.appLog.byAction('push.subscription.expired')).toHaveLength(1);
  });

  it('再試行すれば直りうる失敗(5xx・429・通信)は、その端末にだけ送り直す(届いた端末には送り直さない)', async () => {
    ctx.webPush.setOutcome(ENDPOINT_B, new Error('プッシュサービスが 503 を返しました'));
    await sendTestPush(ctx.deps, taro);
    expect(await ctx.drain()).toMatchObject({ done: 1, retried: 1 });
    expect(messageFor(ENDPOINT_A)).toMatchObject({ status: 'done' });
    expect(messageFor(ENDPOINT_B)).toMatchObject({
      status: 'pending',
      lastError: expect.stringContaining('503'),
    });
    expect(ctx.data().pushSubscriptions.map((p) => p.failureCount)).toEqual([0, 0]);

    // 再試行の時刻まで進めて、直ったら B にだけ送る
    ctx.webPush.setOutcome(ENDPOINT_B, { status: 'delivered' });
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 60_000);
    expect(await ctx.drain()).toMatchObject({ done: 1 });
    expect(ctx.webPush.attempts).toEqual([ENDPOINT_A, ENDPOINT_B, ENDPOINT_B]);
  });

  it('それ以外の 4xx は再試行せず断られた回数を数え、3回続いたら購読を消す', async () => {
    ctx.webPush.setOutcome(ENDPOINT_B, { status: 'rejected', statusCode: 403 });
    for (let i = 1; i <= PUSH_REJECTION_LIMIT; i++) {
      await sendTestPush(ctx.deps, taro);
      expect(await ctx.drain()).toMatchObject({ retried: 0, failed: 0 });
      const b = ctx.data().pushSubscriptions.find((p) => p.endpoint === ENDPOINT_B);
      if (i < PUSH_REJECTION_LIMIT) expect(b?.failureCount).toBe(i);
      else expect(b).toBeUndefined();
    }
    expect(ctx.appLog.byAction('push.subscription.rejected').at(-1)?.details).toMatchObject({
      statusCode: 403,
      deleted: true,
    });
    // 受け付けられている端末は数えない
    expect(ctx.data().pushSubscriptions.map((p) => p.failureCount)).toEqual([0]);
  });

  it('期限を過ぎたら送らずに完了にする(当日に「明日の予定」を出さない)', async () => {
    await sendTestPush(ctx.deps, taro);
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 2 * 60 * 60 * 1000);
    expect(await ctx.drain()).toMatchObject({ done: 2 });
    expect(ctx.webPush.attempts).toEqual([]);
    expect(ctx.appLog.byAction('push.notice.expired')).toHaveLength(2);
  });

  it('積んだ後に別のスタッフへ付け替わった端末には、前の人の通知を送らない', async () => {
    const hanako = (await ctx.addStaff('佐藤 花子', 'hanako@example.com')).actor;
    await sendTestPush(ctx.deps, taro);
    await subscribePush(ctx.deps, hanako, { endpoint: ENDPOINT_A, ...keys });
    expect(await ctx.drain()).toMatchObject({ done: 2 });
    expect(ctx.webPush.attempts).toEqual([ENDPOINT_B]);
  });

  it('VAPID の設定が無いワーカーは送らずに完了にする', async () => {
    await sendTestPush(ctx.deps, taro);
    expect(await processNextOutboxMessage({ ...ctx.deps, webPush: null })).toBe('skipped');
    expect(ctx.webPush.sent).toEqual([]);
  });

  it('ペイロードが壊れていれば再試行しない(failed)', async () => {
    await sendTestPush(ctx.deps, taro);
    const message = ctx.data().outbox[0];
    if (message) message.payload = { staffId: taro.staffId };
    expect(await processNextOutboxMessage(ctx.deps)).toBe('failed');
    expect(ctx.data().outbox[0]).toMatchObject({ status: 'failed' });
  });
});

describe('翌日の予定のお知らせ(夜間ジョブ)', () => {
  let ctx: TestContext;
  let taro: Actor;
  let hanako: Actor;

  const subscriptionIdOf = (endpoint: string) =>
    ctx.data().pushSubscriptions.find((p) => p.endpoint === endpoint)?.id;

  beforeEach(async () => {
    // 2026-09-26 19:00 JST
    ctx = createTestContext({ now: '2026-09-26T10:00:00Z' });
    taro = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    hanako = (await ctx.addStaff('佐藤 花子', 'hanako@example.com')).actor;
    await ctx.addStaff('鈴木 次郎', 'jiro@example.com');
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await subscribePush(ctx.deps, hanako, { endpoint: ENDPOINT_B, ...keys });
    ctx.schedule.setAppointments('山田 太郎', '2026-09-27', [
      appointment('田中 一郎', '09:00', '11:00'),
      appointment('高橋 二郎', '13:00', '15:00'),
    ]);
    ctx.schedule.setAppointments('鈴木 次郎', '2026-09-27', [appointment('伊藤 三郎', '10:00', '12:00')]);
  });

  it('購読を持ち、明日の予定があるスタッフにだけ積む(予定の無い人・購読の無い人には送らない)', async () => {
    const summary = await runRouteNoticeJob(ctx.deps);
    expect(summary).toMatchObject({ queued: 1, alreadyQueued: 0, failed: 0, interrupted: false });
    expect(summary.tenants[0]).toMatchObject({ date: '2026-09-27', targetCount: 2, queued: 1, noEvents: 1 });
    // 軽量版の予定を strict で読む(ルート・地図は使わない)。購読の無い鈴木さんの予定は読まない
    expect(ctx.schedule.calls.map((c) => [c.staffName, c.date, c.options?.strict])).toEqual([
      ['山田 太郎', '2026-09-27', true],
      ['佐藤 花子', '2026-09-27', true],
    ]);
    const subscriptionId = subscriptionIdOf(ENDPOINT_A);
    const [message] = ctx.data().outbox;
    expect(message).toMatchObject({
      topic: 'push.route_notice',
      aggregateId: subscriptionId,
      dedupeKey: `push.route_notice:${subscriptionId}:${taro.staffId}:2026-09-27`,
      payload: { staffId: taro.staffId, subscriptionId, expiresAt: '2026-09-26T15:00:00.000Z' },
    });
    expect(JSON.stringify(message?.payload)).not.toContain('渋谷区');

    expect(await ctx.drain()).toMatchObject({ done: 1 });
    expect(ctx.webPush.sent).toEqual([
      {
        endpoint: ENDPOINT_A,
        notice: {
          title: '明日の予定 9/27(日) 2件',
          body: '09:00〜11:00 田中 一郎様\n13:00〜15:00 高橋 二郎様',
          url: '/?schedule=2026-09-27',
          tag: 'route-notice-2026-09-27',
        },
        // 期限(9/27 0:00 JST)までの5時間
        options: { ttlSeconds: 5 * 60 * 60, topic: 'route-20260927' },
      },
    ]);
  });

  it('予定を読めるテナントが決まっていれば(gas_bridge)、他のテナントは飛ばして INFO を1件残す(失敗にしない)', async () => {
    const skipped = await runRouteNoticeJob({ ...ctx.deps, scheduleTenantSlug: 'bridge-tenant' });
    expect(skipped).toMatchObject({
      tenants: [],
      skippedTenants: [{ tenantId: ctx.tenantId, tenantSlug: 'test-tenant' }],
      queued: 0,
      failed: 0,
    });
    expect(ctx.schedule.calls).toEqual([]);
    expect(ctx.appLog.byAction('push.route_notice.tenant_skipped')).toEqual([
      expect.objectContaining({
        level: 'INFO',
        tenantId: ctx.tenantId,
        details: { date: '2026-09-27', reason: 'schedule_provider_other_tenant' },
      }),
    ]);
    // 持ち主のテナントは今までどおり
    expect(await runRouteNoticeJob({ ...ctx.deps, scheduleTenantSlug: 'test-tenant' })).toMatchObject({
      skippedTenants: [],
      queued: 1,
    });
  });

  it('流し直しても二重に積まず「積み済み」と数える。後からオンにした端末にだけ積む', async () => {
    await runRouteNoticeJob(ctx.deps);
    expect(await runRouteNoticeJob(ctx.deps)).toMatchObject({ queued: 0, alreadyQueued: 1 });
    expect(ctx.data().outbox).toHaveLength(1);
    await subscribePush(ctx.deps, taro, { endpoint: `${ENDPOINT_A}-tablet`, ...keys });
    expect(await runRouteNoticeJob(ctx.deps)).toMatchObject({ queued: 1, alreadyQueued: 0 });
    expect(ctx.data().outbox.map((m) => m.aggregateId)).toEqual([
      subscriptionIdOf(ENDPOINT_A),
      subscriptionIdOf(`${ENDPOINT_A}-tablet`),
    ]);
  });

  it('明日に退職しているスタッフには送らない', async () => {
    ctx.setRetiredOn(taro.staffId, '2026-09-27');
    expect(await runRouteNoticeJob(ctx.deps)).toMatchObject({ queued: 0 });
    expect(ctx.data().outbox).toEqual([]);
  });

  it('予定を読めなかったスタッフは積まずに失敗とし(ジョブは失敗で終わる)、流し直すと積む', async () => {
    ctx.schedule.setError('佐藤 花子', '2026-09-27', 'カレンダーを読み込めませんでした');
    ctx.schedule.setAppointments('佐藤 花子', '2026-09-27', [appointment('田中 一郎', '09:00', '10:00')]);
    const summary = await runRouteNoticeJob(ctx.deps);
    expect(summary).toMatchObject({ queued: 1, failed: 1 });
    expect(summary.tenants[0]?.failures).toEqual([{ staffId: hanako.staffId, error: expect.any(String) }]);
    expect(ctx.appLog.byAction('push.route_notice.staff_failed')).toHaveLength(1);

    ctx.schedule.clearError('佐藤 花子', '2026-09-27');
    expect(await runRouteNoticeJob(ctx.deps)).toMatchObject({ queued: 1, alreadyQueued: 1, failed: 0 });
  });

  it('明日でない日を指定して流し直したら、タイトルは日付で、期限はその日の終わり', async () => {
    ctx.schedule.setAppointments('山田 太郎', '2026-09-28', [appointment('田中 一郎', '09:00', '11:00')]);
    expect(await runRouteNoticeJob(ctx.deps, { date: '2026-09-28' })).toMatchObject({ queued: 1 });
    expect(ctx.data().outbox[0]?.payload).toMatchObject({
      notice: { title: '9/28(月)の予定 1件' },
      expiresAt: '2026-09-28T15:00:00.000Z',
    });
    expect(await runRouteNoticeJob(ctx.deps, { shouldStop: () => true })).toMatchObject({
      interrupted: true,
    });
  });
});
