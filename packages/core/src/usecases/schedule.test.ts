import { beforeEach, describe, expect, it } from 'vitest';
import {
  getFreshScheduleWithRouteForStaff,
  getScheduleForStaff,
  getScheduleWithRouteForStaff,
  UPSTREAM_FAILURE_MESSAGE,
} from './schedule';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

describe('予定の閲覧', () => {
  const date = '2026-09-25';
  let ctx: TestContext;
  let adminId: string;
  let staffId: string;

  beforeEach(async () => {
    ctx = createTestContext();
    adminId = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).staff.id;
    staffId = (await ctx.addStaff('山田 太郎', 'taro@example.com')).staff.id;
  });

  const request = (actorStaffId: string, targetStaffId: string) => ({
    tenantId: ctx.tenantId,
    actorStaffId,
    targetStaffId,
    date,
  });

  it('SchedulePort にはスタッフID と氏名(DB の値)を渡す', async () => {
    await getScheduleForStaff(ctx.deps, request(staffId, staffId));
    expect(ctx.schedule.calls[0]).toMatchObject({ staffId, staffName: '山田 太郎', date });
  });

  it('軽量版の成功はログを残さず、ルートつきは INFO で残す(他人を扱えば targetStaffId も)', async () => {
    await getScheduleForStaff(ctx.deps, request(staffId, staffId));
    expect(ctx.appLog.entries).toHaveLength(0);
    await getScheduleWithRouteForStaff(ctx.deps, { ...request(adminId, staffId), forceRefresh: true });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'INFO',
      action: 'schedule.route.succeeded',
      actorStaffId: adminId,
      targetStaffId: staffId,
      details: { date, forceRefresh: true, appointmentCount: 0 },
    });
  });

  it('ルートつきの INFO には地図APIを実際に呼んだ回数・キャッシュで済ませた回数と、部分的な結果かを載せる', async () => {
    const schedule = {
      getSchedule: async () => ({ success: true, appointments: [] }),
      getScheduleWithRoute: async (
        _target: unknown,
        _date: string,
        _force: boolean,
        options?: {
          onMapsUsage?: (u: { geocodeCalls: number; routeCalls: number; cacheHits: number }) => void;
        },
      ) => {
        options?.onMapsUsage?.({ geocodeCalls: 1, routeCalls: 2, cacheHits: 3 });
        return { success: true, appointments: [], partial: true };
      },
    };
    const result = await getScheduleWithRouteForStaff(
      { ...ctx.deps, schedule },
      { ...request(staffId, staffId), forceRefresh: false },
    );
    expect(result.partial).toBe(true);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      action: 'schedule.route.succeeded',
      details: { forceRefresh: false, geocodeCalls: 1, routeCalls: 2, cacheHits: 3, partial: true },
    });
  });

  it('記録に書く処理はキャッシュを使わない(fresh)', async () => {
    await getFreshScheduleWithRouteForStaff(ctx.deps, { ...request(staffId, staffId), actorStaffId: null });
    expect(ctx.schedule.calls[0]).toMatchObject({ forceRefresh: false, options: { fresh: true } });
  });

  it('success:false は WARN、存在しないスタッフは WARN と失敗の結果', async () => {
    ctx.schedule.setFailure('山田 太郎', date, 'カレンダーが見つかりません');
    expect((await getScheduleForStaff(ctx.deps, request(staffId, staffId))).success).toBe(false);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({ level: 'WARN', action: 'schedule.view.failed' });
    const missing = await getScheduleForStaff(
      ctx.deps,
      request(staffId, '00000000-0000-7000-8000-00000000ffff'),
    );
    expect(missing).toMatchObject({ success: false, message: 'スタッフが見つかりません' });
  });

  it('外部サービスの例外は詳細をログにだけ残し、一般的な文言の upstream_unavailable にする', async () => {
    ctx.schedule.setError('山田 太郎', date, 'Maps API quota exceeded (key=xyz)');
    await expect(
      getScheduleWithRouteForStaff(ctx.deps, { ...request(staffId, staffId), forceRefresh: false }),
    ).rejects.toMatchObject({
      code: 'upstream_unavailable',
      message: UPSTREAM_FAILURE_MESSAGE,
    });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'ERROR',
      action: 'schedule.route.error',
      details: { message: 'Maps API quota exceeded (key=xyz)' },
    });
  });
});
