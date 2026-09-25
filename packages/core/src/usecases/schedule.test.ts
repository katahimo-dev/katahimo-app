import { beforeEach, describe, expect, it } from 'vitest';
import type { AppLogEntry } from '../ports/appLog';
import type {
  ScheduleLightResult,
  SchedulePort,
  ScheduleWithRouteOptions,
  ScheduleWithRouteResult,
} from '../ports/schedule';
import type { ScheduleDeps } from './schedule';
import {
  getFreshScheduleWithRouteForStaff,
  getScheduleForStaff,
  getScheduleWithRouteForStaff,
} from './schedule';
import { FakeStaffRepository } from './testDoubles';

class RecordingSchedulePort implements SchedulePort {
  calls: Array<{
    method: string;
    staffName: string;
    forceRefresh?: boolean;
    options?: ScheduleWithRouteOptions;
  }> = [];
  next: ScheduleWithRouteResult | Error = { success: true, appointments: [] };

  async getSchedule(
    staffName: string,
    _date: string,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleLightResult> {
    this.calls.push({ method: 'getSchedule', staffName, options });
    if (this.next instanceof Error) throw this.next;
    return { success: this.next.success, message: this.next.message, appointments: [] };
  }

  async getScheduleWithRoute(
    staffName: string,
    _date: string,
    forceRefresh: boolean,
    options?: ScheduleWithRouteOptions,
  ): Promise<ScheduleWithRouteResult> {
    this.calls.push({ method: 'getScheduleWithRoute', staffName, forceRefresh, options });
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe('schedule usecases', () => {
  const tenantId = 'tenant-1';
  const date = '2026-09-25';
  let schedule: RecordingSchedulePort;
  let logs: AppLogEntry[];
  let deps: ScheduleDeps;
  let adminId: string;
  let staffId: string;

  beforeEach(async () => {
    schedule = new RecordingSchedulePort();
    logs = [];
    const staff = new FakeStaffRepository();
    adminId = (await staff.create({ tenantId, name: '管理 太郎', email: 'admin@x', isAdmin: true })).id;
    staffId = (await staff.create({ tenantId, name: '佐藤 美咲', email: 'sato@x', isAdmin: false })).id;
    deps = { schedule, staff, appLog: { write: async (e) => void logs.push(e) } };
  });

  it('スタッフIDを氏名に変換し、tenantId を添えて SchedulePort を呼ぶ。軽量版の成功はログを残さない', async () => {
    const result = await getScheduleForStaff(deps, {
      tenantId,
      actorStaffId: staffId,
      targetStaffId: staffId,
      date,
    });
    expect(result.success).toBe(true);
    expect(schedule.calls).toEqual([
      { method: 'getSchedule', staffName: '佐藤 美咲', options: { tenantId } },
    ]);
    expect(logs).toEqual([]);
  });

  it('ルート計算は成功もINFOで記録し、管理者が他スタッフを見た場合は対象スタッフも残す', async () => {
    schedule.next = { success: true, appointments: [{} as never, {} as never] };
    await getScheduleWithRouteForStaff(deps, {
      tenantId,
      actorStaffId: adminId,
      targetStaffId: staffId,
      date,
      forceRefresh: true,
    });
    expect(schedule.calls[0]).toEqual({
      method: 'getScheduleWithRoute',
      staffName: '佐藤 美咲',
      forceRefresh: true,
      options: { tenantId },
    });
    expect(logs).toEqual([
      {
        tenantId,
        level: 'INFO',
        action: 'schedule.route.succeeded',
        actorStaffId: adminId,
        targetStaffId: staffId,
        details: { date, appointmentCount: 2, forceRefresh: true },
      },
    ]);
  });

  it('本人の閲覧では targetStaffId を残さない', async () => {
    await getScheduleWithRouteForStaff(deps, {
      tenantId,
      actorStaffId: staffId,
      targetStaffId: staffId,
      date,
      forceRefresh: false,
    });
    expect(logs[0]?.targetStaffId).toBeNull();
  });

  it('success:false はWARN、例外はERRORで記録し、どちらも success:false の結果で返す', async () => {
    schedule.next = { success: false, message: 'カレンダーエラー' };
    const failed = await getScheduleForStaff(deps, {
      tenantId,
      actorStaffId: staffId,
      targetStaffId: staffId,
      date,
    });
    expect(failed).toEqual({ success: false, message: 'カレンダーエラー', appointments: [] });
    expect(logs[0]).toMatchObject({
      level: 'WARN',
      action: 'schedule.view.failed',
      details: { message: 'カレンダーエラー' },
    });

    schedule.next = new Error('Routes API エラー');
    const thrown = await getScheduleWithRouteForStaff(deps, {
      tenantId,
      actorStaffId: staffId,
      targetStaffId: staffId,
      date,
      forceRefresh: false,
    });
    expect(thrown).toEqual({ success: false, message: 'Routes API エラー', appointments: [] });
    expect(logs[1]).toMatchObject({ level: 'ERROR', action: 'schedule.route.error' });
  });

  it('存在しないスタッフは SchedulePort を呼ばずに失敗', async () => {
    const result = await getScheduleForStaff(deps, {
      tenantId,
      actorStaffId: staffId,
      targetStaffId: 'nobody',
      date,
    });
    expect(result).toEqual({ success: false, message: 'スタッフが見つかりません', appointments: [] });
    expect(schedule.calls).toEqual([]);
    expect(logs[0]).toMatchObject({ level: 'WARN', details: { reason: 'staff_not_found' } });
  });

  it('勤怠記録用はキャッシュを使わない fresh 指定で呼ぶ(操作者のいないバッチも可)', async () => {
    await getFreshScheduleWithRouteForStaff(deps, {
      tenantId,
      actorStaffId: null,
      targetStaffId: staffId,
      date,
    });
    expect(schedule.calls[0]).toEqual({
      method: 'getScheduleWithRoute',
      staffName: '佐藤 美咲',
      forceRefresh: false,
      options: { tenantId, fresh: true },
    });
    expect(logs[0]).toMatchObject({
      level: 'INFO',
      action: 'schedule.route_fresh.succeeded',
      actorStaffId: null,
    });
  });
});
