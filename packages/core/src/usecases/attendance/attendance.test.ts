import { beforeEach, describe, expect, it } from 'vitest';
import type { ScheduleAppointmentWithRoute } from '../../ports/schedule';
import type { Actor } from '../requestMeta';
import type { TestContext } from '../testContext';
import { createTestContext } from '../testContext';
import { applyCalendarSync, previewCalendarSync, refreshAttendanceAggregate } from './calendarSync';
import { getAttendanceDay, updateAttendanceDay } from './day';
import { runNightlyCalendarSync } from './nightlySync';

const DATE = '2026-09-24';

function appointment(
  customerName: string,
  startTime: string,
  endTime: string,
  extra: Partial<ScheduleAppointmentWithRoute> = {},
): ScheduleAppointmentWithRoute {
  return {
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
    ...extra,
  };
}

describe('出勤簿の閲覧・手入力', () => {
  let ctx: TestContext;
  let staff: Actor;
  let other: Actor;
  let admin: Actor;

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
  });

  it('記録の無い日は空の行と版0を返す', async () => {
    const view = await getAttendanceDay(ctx.deps, staff, staff.staffId, DATE);
    expect(view).toMatchObject({
      found: false,
      rowData: {},
      rowVersion: 0,
      editable: true,
      staffName: '山田 太郎',
    });
  });

  it('手入力は変わった列だけを実体に書き、上書きした項目・変更履歴・ミラーを同じトランザクションで残す', async () => {
    const result = await updateAttendanceDay(ctx.deps, staff, staff.staffId, DATE, {
      C: '佐藤様',
      D: '9:00',
      E: '12:00',
      AG: '6',
    });
    expect(result.message).toBe('修正しました。');
    expect(result.attendance.rowData).toMatchObject({ C: '佐藤様', D: '09:00', E: '12:00', AG: '6.00' });
    expect(result.attendance.rowVersion).toBe(2);
    expect(ctx.data().visits).toHaveLength(1);
    expect(ctx.data().visits[0]?.overriddenFields).toEqual(
      expect.arrayContaining(['label', 'actual_start', 'actual_end']),
    );
    expect(ctx.data().entityChanges.length).toBeGreaterThan(0);
    expect(ctx.data().outbox.map((m) => m.topic)).toEqual(['mirror.attendance_day']);
    expect(result.attendance.changedFields).toEqual(expect.arrayContaining(['C', 'D', 'E']));
  });

  it('変更が無ければ何も書かない(日の行も作らない)', async () => {
    const result = await updateAttendanceDay(ctx.deps, staff, staff.staffId, DATE, { C: '' });
    expect(result.message).toBe('変更はありませんでした。');
    expect(ctx.data().days).toHaveLength(0);
    expect(ctx.data().outbox).toHaveLength(0);
  });

  it('画面が読んだ版と違えば 409 conflict(WARN ログ)', async () => {
    const first = await updateAttendanceDay(ctx.deps, staff, staff.staffId, DATE, { C: '佐藤様' });
    await updateAttendanceDay(
      ctx.deps,
      staff,
      staff.staffId,
      DATE,
      { C: '田中様' },
      first.attendance.rowVersion,
    );
    await expect(
      updateAttendanceDay(ctx.deps, staff, staff.staffId, DATE, { C: '鈴木様' }, first.attendance.rowVersion),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'stale_row_version' });
    expect(ctx.appLog.byAction('attendance.day.update_conflict')).toHaveLength(1);
  });

  it('当月以外は誰も修正できず(locked)、締めた月は DB 側でも拒否する', async () => {
    await expect(
      updateAttendanceDay(ctx.deps, admin, staff.staffId, '2026-08-31', { C: 'x' }),
    ).rejects.toMatchObject({
      code: 'locked',
    });
    await ctx.uow.run(ctx.tenantId, (r) =>
      r.attendance.lockPeriod(staff.staffId, '2026-09', admin.staffId, ctx.clock.now),
    );
    await expect(updateAttendanceDay(ctx.deps, staff, staff.staffId, DATE, { C: 'x' })).rejects.toMatchObject(
      {
        code: 'locked',
      },
    );
    expect(ctx.appLog.byAction('attendance.day.update_locked')).toHaveLength(2);
  });

  it('時刻の形式が正しくなければ validation_failed(項目名つき)', async () => {
    await expect(
      updateAttendanceDay(ctx.deps, staff, staff.staffId, DATE, { D: '25:99' }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { 'rowData.D': expect.any(String) },
    });
  });

  it('一般スタッフは他人の出勤簿を扱えず(forbidden)、管理者は扱える', async () => {
    await expect(
      updateAttendanceDay(ctx.deps, staff, other.staffId, DATE, { C: '佐藤様' }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    await updateAttendanceDay(ctx.deps, admin, other.staffId, DATE, { C: '田中様' });
    expect((await getAttendanceDay(ctx.deps, admin, other.staffId, DATE)).rowData.C).toBe('田中様');
  });
});

describe('カレンダーからの反映', () => {
  let ctx: TestContext;
  let staff: Actor;
  let admin: Actor;

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    ctx.schedule.setAppointments('山田 太郎', DATE, [
      appointment('佐藤様', '09:00', '11:00', { attendanceKm: '3.20' }),
      appointment('田中様', '13:00', '15:00', { moveMin: 20, moveKm: '5.50' }),
    ]);
  });

  it('プレビューは何も書かず、反映は冪等(2回目は変更なし・ミラーも積まない)', async () => {
    const preview = await previewCalendarSync(ctx.deps, staff, staff.staffId, DATE);
    expect(preview.hasChanges).toBe(true);
    expect(ctx.data().days).toHaveLength(0);

    const first = await applyCalendarSync(ctx.deps, staff, staff.staffId, DATE);
    expect(first.changes.length).toBeGreaterThan(0);
    const view = await getAttendanceDay(ctx.deps, staff, staff.staffId, DATE);
    expect(view.rowData).toMatchObject({
      C: '佐藤様',
      D: '09:00',
      E: '11:00',
      L: '田中様',
      M: '13:00',
      N: '15:00',
    });
    expect(ctx.data().visits.every((v) => v.source === 'google_calendar')).toBe(true);
    const outboxAfterFirst = ctx.data().outbox.length;

    const second = await applyCalendarSync(ctx.deps, staff, staff.staffId, DATE);
    expect(second.changes).toEqual([]);
    expect(ctx.data().outbox.length).toBe(outboxAfterFirst);
  });

  it('手入力で足した(カレンダーに無く、時間の重ならない)予定は反映で消さない(GAS版と同じ)', async () => {
    await applyCalendarSync(ctx.deps, staff, staff.staffId, DATE);
    await updateAttendanceDay(ctx.deps, staff, staff.staffId, DATE, {
      U: '手入力様',
      V: '16:00',
      W: '17:00',
    });
    await applyCalendarSync(ctx.deps, staff, staff.staffId, DATE);
    expect((await getAttendanceDay(ctx.deps, staff, staff.staffId, DATE)).rowData).toMatchObject({
      U: '手入力様',
      V: '16:00',
      W: '17:00',
    });
  });

  it('勤怠集計の書き直しは管理者だけ', async () => {
    await expect(refreshAttendanceAggregate(ctx.deps, staff, staff.staffId, DATE)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const refreshed = await refreshAttendanceAggregate(ctx.deps, admin, staff.staffId, DATE);
    expect(refreshed.appointmentCount).toBe(2);
    expect(ctx.data().outbox.map((m) => m.topic)).toContain('mirror.attendance_aggregate');
  });

  it('夜間バッチはテナントのタイムゾーンの今日を、その日に在籍するスタッフについて反映する', async () => {
    ctx.clock.now = new Date('2026-09-24T13:00:00Z'); // JST 9/24 22:00
    ctx.setRetiredOn(admin.staffId, '2026-09-24');
    const summary = await runNightlyCalendarSync(ctx.deps);
    expect(summary.tenants[0]).toMatchObject({
      date: DATE,
      staffCount: 1,
      succeeded: 1,
      changedStaffCount: 1,
    });
  });

  it('ミラーは worker が送り、MIRROR が無効なら送らずに完了にする', async () => {
    await applyCalendarSync(ctx.deps, staff, staff.staffId, DATE);
    ctx.deps.mirrorEnabled = false;
    const result = await ctx.drain();
    expect(result.skipped).toBeGreaterThan(0);
    expect(ctx.sender.attendanceDays).toHaveLength(0);
  });
});
