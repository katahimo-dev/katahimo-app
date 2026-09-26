import { beforeEach, describe, expect, it } from 'vitest';
import type { ScheduleAppointmentWithRoute } from '../ports/schedule';
import { processNextOutboxMessage } from './outboxWorker';
import {
  PUSH_DISABLED_MESSAGE,
  PUSH_NOT_SUBSCRIBED_MESSAGE,
  pushConfigOf,
  runRouteNoticeJob,
  sendTestPush,
  subscribePush,
  unsubscribePush,
} from './pushNotifications';
import type { Actor } from './requestMeta';
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

  it('テスト通知は本人の全ての端末に送る(購読が無ければ断る)', async () => {
    await expect(sendTestPush(ctx.deps, taro)).rejects.toMatchObject({
      message: PUSH_NOT_SUBSCRIBED_MESSAGE,
    });
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_B, ...keys });
    await subscribePush(ctx.deps, hanako, { endpoint: 'https://fcm.googleapis.com/fcm/send/other', ...keys });
    expect(await sendTestPush(ctx.deps, taro)).toEqual({ subscriptionCount: 2 });
    expect(await sendTestPush(ctx.deps, taro)).toEqual({ subscriptionCount: 2 });
    // 押すたびに積む
    expect(ctx.data().outbox.filter((m) => m.topic === 'push.test')).toHaveLength(2);
    expect(await ctx.drain()).toMatchObject({ done: 2 });
    expect(ctx.webPush.sent.map((s) => s.endpoint).sort()).toEqual(
      [ENDPOINT_B, ENDPOINT_A, ENDPOINT_B, ENDPOINT_A].sort(),
    );
    expect(ctx.webPush.sent[0]?.notice.title).toBe('テスト通知');
  });
});

describe('Web Push の送信(outbox)', () => {
  let ctx: TestContext;
  let taro: Actor;

  beforeEach(async () => {
    ctx = createTestContext({ now: '2026-09-26T10:00:00Z' });
    taro = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_A, ...keys });
    await subscribePush(ctx.deps, taro, { endpoint: ENDPOINT_B, ...keys });
  });

  it('受け付けられたら最後の成功時刻を残す', async () => {
    await sendTestPush(ctx.deps, taro);
    expect(await processNextOutboxMessage(ctx.deps)).toBe('done');
    expect(ctx.data().pushSubscriptions.map((p) => p.lastSuccessAt)).toEqual([ctx.clock.now, ctx.clock.now]);
  });

  it('410 Gone(購読がもう無い)の購読は消し、他の端末には送る', async () => {
    ctx.webPush.setOutcome(ENDPOINT_A, 'expired');
    await sendTestPush(ctx.deps, taro);
    expect(await processNextOutboxMessage(ctx.deps)).toBe('done');
    expect(ctx.data().pushSubscriptions.map((p) => p.endpoint)).toEqual([ENDPOINT_B]);
    expect(ctx.webPush.sent.map((s) => s.endpoint)).toEqual([ENDPOINT_B]);
    expect(ctx.appLog.byAction('push.subscription.expired')).toHaveLength(1);
  });

  it('それ以外の失敗は失敗の回数を数え、outbox の再試行に任せる', async () => {
    ctx.webPush.setOutcome(ENDPOINT_B, new Error('プッシュサービスが 503 を返しました'));
    await sendTestPush(ctx.deps, taro);
    expect(await processNextOutboxMessage(ctx.deps)).toBe('retried');
    const [a, b] = ctx.data().pushSubscriptions;
    expect(a).toMatchObject({ failureCount: 0, lastSuccessAt: ctx.clock.now });
    expect(b).toMatchObject({ failureCount: 1, lastSuccessAt: null });
    expect(ctx.data().outbox[0]).toMatchObject({ status: 'pending' });
    expect(ctx.data().outbox[0]?.lastError).toContain('1/2件');
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
  let jiro: Actor;

  beforeEach(async () => {
    // 2026-09-26 19:00 JST
    ctx = createTestContext({ now: '2026-09-26T10:00:00Z' });
    taro = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    hanako = (await ctx.addStaff('佐藤 花子', 'hanako@example.com')).actor;
    jiro = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
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
    expect(summary).toMatchObject({ queued: 1, failed: 0, interrupted: false });
    expect(summary.tenants[0]).toMatchObject({ date: '2026-09-27', targetCount: 2, queued: 1, noEvents: 1 });
    // 軽量版の予定だけを読む(ルート・地図は使わない)。購読の無い鈴木さんの予定は読まない
    expect(ctx.schedule.calls.map((c) => [c.staffName, c.date])).toEqual([
      ['山田 太郎', '2026-09-27'],
      ['佐藤 花子', '2026-09-27'],
    ]);
    const [message] = ctx.data().outbox;
    expect(message).toMatchObject({
      topic: 'push.route_notice',
      aggregateId: taro.staffId,
      dedupeKey: `push.route_notice:${taro.staffId}:2026-09-27`,
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
        options: { ttlSeconds: 24 * 60 * 60, topic: 'route-20260927' },
      },
    ]);
    expect(jiro.staffId).toBeTruthy();
  });

  it('流し直しても同じスタッフ・同じ日には二重に積まない', async () => {
    await runRouteNoticeJob(ctx.deps);
    await runRouteNoticeJob(ctx.deps);
    expect(ctx.data().outbox).toHaveLength(1);
  });

  it('明日に退職しているスタッフには送らない', async () => {
    ctx.setRetiredOn(taro.staffId, '2026-09-27');
    expect(await runRouteNoticeJob(ctx.deps)).toMatchObject({ queued: 0 });
    expect(ctx.data().outbox).toEqual([]);
  });

  it('予定を読めなかったスタッフは失敗として数え、他のスタッフは続ける', async () => {
    ctx.schedule.setError('佐藤 花子', '2026-09-27', 'calendar down');
    ctx.schedule.setAppointments('佐藤 花子', '2026-09-27', [appointment('田中 一郎', '09:00', '10:00')]);
    const summary = await runRouteNoticeJob(ctx.deps);
    expect(summary).toMatchObject({ queued: 1, failed: 1 });
    expect(summary.tenants[0]?.failures).toEqual([{ staffId: hanako.staffId, error: expect.any(String) }]);
    expect(ctx.appLog.byAction('push.route_notice.staff_failed')).toHaveLength(1);
  });

  it('日付を指定して流し直せる・停止の合図で止まる', async () => {
    expect(await runRouteNoticeJob(ctx.deps, { date: '2026-09-28' })).toMatchObject({ queued: 0 });
    expect(await runRouteNoticeJob(ctx.deps, { shouldStop: () => true })).toMatchObject({
      interrupted: true,
    });
  });
});
