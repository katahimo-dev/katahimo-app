import type { ScheduleAppointmentWithRoute } from '@katahimo/core/ports';
import { createTestContext } from '@katahimo/core/test-utils';
import { runNightlyCalendarSync, subscribePush } from '@katahimo/core/usecases';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerContainer } from '../container';
import { runNightlyCalendarSyncJob } from './nightlyCalendarSync';
import { drainOutboxAfterBatch } from './outboxDrain';
import { runRouteNoticeJob } from './routeNotice';
import { StopSignal } from './stopSignal';

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
  address: '',
});

/** テスト用の依存一式(インメモリ)をワーカーの container として使う。 */
function containerOf(ctx: ReturnType<typeof createTestContext>): WorkerContainer {
  return { ...ctx.deps, outboxDrainMax: 100 } as unknown as WorkerContainer;
}

describe('バッチのジョブは積んだ outbox をジョブの中で送る(別のジョブの起動を頼まない)', () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  let ctx: ReturnType<typeof createTestContext>;
  beforeEach(() => {
    // 2026-09-24 22:00 JST(夜間の反映の時刻。お知らせは翌日 9/25 の予定)
    ctx = createTestContext({ now: '2026-09-24T13:00:00Z' });
  });

  it('翌日の予定のお知らせ: 積んだ push.route_notice をそのまま送り終える', async () => {
    const { actor } = await ctx.addStaff('山田 太郎', 'taro@example.com');
    await subscribePush(ctx.deps, actor, {
      endpoint: 'https://fcm.googleapis.com/fcm/send/device-a',
      p256dh: 'p'.repeat(87),
      auth: 'a'.repeat(22),
    });
    ctx.schedule.setAppointments('山田 太郎', '2026-09-25', [appointment('田中 一郎', '09:00', '11:00')]);

    const result = await runRouteNoticeJob(containerOf(ctx), { stop: new StopSignal() });
    expect(result).toMatchObject({ ok: true, summary: { queued: 1 } });
    expect(ctx.webPush.sent).toHaveLength(1);
    expect(ctx.data().outbox).toEqual([
      expect.objectContaining({ topic: 'push.route_notice', status: 'done' }),
    ]);
  });

  it('夜間のカレンダー反映: 反映で積んだミラーを送り終える。送れなくてもジョブは成功のまま(見回りが再試行する)', async () => {
    await ctx.addStaff('山田 太郎', 'taro@example.com');
    ctx.schedule.setAppointments('山田 太郎', '2026-09-24', [appointment('田中 一郎', '09:00', '11:00')]);
    ctx.sender.failures = 100;

    const result = await runNightlyCalendarSyncJob(containerOf(ctx), { stop: new StopSignal() });
    expect(result.ok).toBe(true);
    const topics = ctx.data().outbox.map((m) => [m.topic, m.status]);
    expect(topics.length).toBeGreaterThan(0);
    expect(topics.every(([topic, status]) => topic?.startsWith('mirror.') && status === 'pending')).toBe(
      true,
    );
    expect(ctx.data().outbox.every((m) => m.attempts === 1)).toBe(true);

    ctx.sender.failures = 0;
    ctx.clock.now = new Date('2026-09-24T14:00:00Z');
    await runNightlyCalendarSyncJob(containerOf(ctx), { stop: new StopSignal() });
    // 変わっていなければ反映では積まない(送るのは再試行の時刻を過ぎた見回り)
    expect(ctx.data().outbox.every((m) => m.status === 'pending')).toBe(true);
    expect(await ctx.drain()).toMatchObject({ done: topics.length });
  });

  it('停止の合図の後は送らない。outbox を読めなくても例外にせず WARNING を書く', async () => {
    await ctx.addStaff('山田 太郎', 'taro@example.com');
    ctx.schedule.setAppointments('山田 太郎', '2026-09-24', [appointment('田中 一郎', '09:00', '11:00')]);
    await runNightlyCalendarSync(ctx.deps);
    const queued = ctx.data().outbox.length;
    expect(queued).toBeGreaterThan(0);

    const stop = new StopSignal();
    stop.stop();
    await drainOutboxAfterBatch(containerOf(ctx), 'nightly-calendar-sync', stop);
    expect(ctx.data().outbox.every((m) => m.status === 'pending' && m.attempts === 0)).toBe(true);

    const log = vi.spyOn(console, 'log');
    const broken = containerOf(ctx);
    broken.queue.claimNext = async () => {
      throw new Error('connection refused');
    };
    await expect(
      drainOutboxAfterBatch(broken, 'nightly-calendar-sync', new StopSignal()),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"severity":"WARNING"'));
    expect(ctx.data().outbox).toHaveLength(queued);
  });
});
