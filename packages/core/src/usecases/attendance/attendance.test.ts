import { beforeEach, describe, expect, it } from 'vitest';
import type { ScheduleAppointmentWithRoute } from '../../ports/schedule';
import { registerStaff } from '../auth';
import {
  FakeAppLogPort,
  FakeAttendanceDayRepository,
  FakeCryptoPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakeReceiptRepository,
  FakeSchedulePort,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from '../testDoubles';
import type { AttendanceActor } from './access';
import { applyCalendarSync, previewCalendarSync, refreshAttendanceAggregate } from './calendarSync';
import { getAttendanceDay, updateAttendanceDay } from './day';
import type { NightlyCalendarSyncDeps } from './deps';
import { AttendanceError } from './errors';
import { getAttendanceMonth } from './month';
import { runNightlyCalendarSync } from './nightlySync';
import { getAttendanceScheduleEvents } from './week';

/** 2026-09-25 12:00 JST */
const NOW = new Date('2026-09-25T03:00:00Z');

function appointment(overrides: Partial<ScheduleAppointmentWithRoute>): ScheduleAppointmentWithRoute {
  return {
    eventType: 'CUSTOMER APPOINTMENT',
    customerName: '',
    startTime: '',
    endTime: '',
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
    ...overrides,
  };
}

describe('勤怠usecase', () => {
  let tenants: FakeTenantRepository;
  let staff: FakeStaffRepository;
  let attendanceDays: FakeAttendanceDayRepository;
  let outbox: FakeOutboxRepository;
  let receipts: FakeReceiptRepository;
  let schedule: FakeSchedulePort;
  let appLog: FakeAppLogPort;
  let deps: NightlyCalendarSyncDeps & { receipts: FakeReceiptRepository };
  let tenantId: string;
  let self: AttendanceActor;
  let admin: AttendanceActor;
  let otherStaffId: string;

  beforeEach(async () => {
    tenants = new FakeTenantRepository();
    staff = new FakeStaffRepository();
    attendanceDays = new FakeAttendanceDayRepository();
    outbox = new FakeOutboxRepository();
    receipts = new FakeReceiptRepository();
    schedule = new FakeSchedulePort();
    appLog = new FakeAppLogPort();
    const crypto = new FakeCryptoPort();
    deps = {
      tenants,
      staff,
      attendanceDays,
      crypto,
      mirror: outbox,
      appLog,
      schedule,
      receipts,
      now: () => NOW,
    };

    tenantId = (await tenants.create({ name: 'テスト', slug: 'test' })).id;
    const authDeps = {
      tenants,
      staff,
      sessions: new FakeSessionRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
    const hanako = await registerStaff(authDeps, {
      tenantId,
      name: '佐藤 花子',
      email: 'hanako@example.com',
      password: 'pw',
      isAdmin: false,
    });
    const boss = await registerStaff(authDeps, {
      tenantId,
      name: '管理者 太郎',
      email: 'admin@example.com',
      password: 'pw',
      isAdmin: true,
    });
    self = { tenantId, staffId: hanako.id, isAdmin: false };
    admin = { tenantId, staffId: boss.id, isAdmin: true };
    otherStaffId = hanako.id;
  });

  describe('getAttendanceDay', () => {
    it('記録の無い日は found=false・空のrowDataで、当月の編集可否と天候の選択肢を返す', async () => {
      const day = await getAttendanceDay(deps, self, self.staffId, '2026-09-10');
      expect(day).toMatchObject({
        found: false,
        rowData: {},
        staffName: '佐藤 花子',
        editable: true,
        editableFrom: '2026-09-01',
        editableTo: '2026-09-30',
        optionsI: ['晴れ', '曇り', '雨', '雪'],
        optionsR: ['晴れ', '曇り', '雨', '雪'],
      });
      expect((await getAttendanceDay(deps, self, self.staffId, '2026-08-31')).editable).toBe(false);
    });

    it('一般スタッフは他スタッフを指定できない', async () => {
      await expect(getAttendanceDay(deps, self, admin.staffId, '2026-09-10')).rejects.toMatchObject({
        code: 'forbidden',
      });
    });

    it('管理者が他スタッフを見た場合だけ操作者付きでINFOログを残す', async () => {
      await getAttendanceDay(deps, self, self.staffId, '2026-09-10');
      expect(appLog.entries).toEqual([]);
      await getAttendanceDay(deps, admin, otherStaffId, '2026-09-10');
      expect(appLog.byAction('attendance.day.view')).toEqual([
        expect.objectContaining({ level: 'INFO', actorStaffId: admin.staffId, targetStaffId: otherStaffId }),
      ]);
    });

    it('存在しないスタッフは staff_not_found', async () => {
      await expect(getAttendanceDay(deps, admin, 'missing', '2026-09-10')).rejects.toMatchObject({
        code: 'staff_not_found',
      });
    });
  });

  describe('updateAttendanceDay(手入力の修正)', () => {
    it('当月以外の日付は管理者でも修正できず、何も保存しない', async () => {
      const error = await updateAttendanceDay(deps, admin, otherStaffId, '2026-08-31', { C: 'x' }).catch(
        (e) => e,
      );
      expect(error).toBeInstanceOf(AttendanceError);
      expect(error).toMatchObject({
        code: 'locked',
        message: '修正期限切れです。当月(09/01)より前の記録は変更できません。',
      });
      await expect(
        updateAttendanceDay(deps, self, self.staffId, '2026-10-01', { C: 'x' }),
      ).rejects.toMatchObject({
        code: 'locked',
      });
      expect(attendanceDays.countForTest()).toBe(0);
      expect(appLog.byAction('attendance.day.update_locked')).toHaveLength(2);
    });

    it('変わった列だけを保存し、changed_fields・変更者・変更前の行の履歴・ミラーを記録する', async () => {
      const first = await updateAttendanceDay(deps, self, self.staffId, '2026-09-10', {
        C: '佐藤様',
        D: '10:00',
      });
      expect(first.message).toBe('修正しました。');
      expect(first.changes.map((c) => c.column)).toEqual(['C', 'D']);

      const second = await updateAttendanceDay(deps, admin, otherStaffId, '2026-09-10', {
        C: '佐藤様',
        D: '10:30',
        E: '12:00',
      });
      expect(second.changes.map((c) => [c.column, c.oldValue, c.newValue])).toEqual([
        ['D', '10:00', '10:30'],
        ['E', '', '12:00'],
      ]);
      expect(second.attendance).toMatchObject({
        found: true,
        rowData: { C: '佐藤様', D: '10:30', E: '12:00' },
        changedFields: ['C', 'D', 'E'],
      });
      expect(second.attendance.derived.workedMinutes).toBe(90);

      const record = await attendanceDays.findByStaffAndDate(tenantId, self.staffId, '2026-09-10');
      expect(record).toMatchObject({ changedFields: ['C', 'D', 'E'], lastChangedByStaffId: admin.staffId });
      expect(attendanceDays.history).toEqual([
        {
          attendanceDayId: record?.id,
          changedByStaffId: self.staffId,
          changedFields: ['C', 'D'],
          previousRowData: null,
        },
        {
          attendanceDayId: record?.id,
          changedByStaffId: admin.staffId,
          changedFields: ['D', 'E'],
          previousRowData: { ciphertext: 'ENC:{"C":"佐藤様","D":"10:00"}', keyVersion: 1 },
        },
      ]);
      expect(outbox.listAllForTest().filter((j) => j.kind === 'attendance_day')).toHaveLength(2);
    });

    it('値が同じなら「変更はありませんでした。」で、保存・履歴・ミラーは行わない', async () => {
      await updateAttendanceDay(deps, self, self.staffId, '2026-09-10', { C: '佐藤様' });
      const result = await updateAttendanceDay(deps, self, self.staffId, '2026-09-10', {
        C: '佐藤様',
        D: '',
      });
      expect(result.message).toBe('変更はありませんでした。');
      expect(result.changes).toEqual([]);
      expect(attendanceDays.history).toHaveLength(1);
      expect(outbox.listAllForTest()).toHaveLength(1);
    });
  });

  describe('カレンダー → 出勤簿', () => {
    beforeEach(() => {
      schedule.setAppointments('佐藤 花子', '2026-09-10', [
        appointment({ customerName: '鈴木様', startTime: '10:00', endTime: '12:00', attendanceKm: 4.5 }),
        appointment({
          customerName: '田中様',
          startTime: '13:00',
          endTime: '14:00',
          moveMin: 20,
          moveKm: 6,
          leavingKm: 8,
        }),
        appointment({
          eventType: 'OFFICE WORK',
          customerName: '広報業務',
          startTime: '15:00',
          endTime: '16:00',
        }),
      ]);
    });

    it('プレビューは書き込まずに差分だけを返し、予定は常に最新(forceRefresh)で取る', async () => {
      const preview = await previewCalendarSync(deps, self, self.staffId, '2026-09-10');
      expect(preview).toMatchObject({ appointmentCount: 3, hasChanges: true, staffName: '佐藤 花子' });
      expect(preview.changes.map((c) => c.column)).toEqual([
        'C',
        'D',
        'E',
        'AI',
        'H',
        'L',
        'M',
        'N',
        'AG',
        'X',
        'Y',
        'Z',
        'AJ',
      ]);
      expect(schedule.calls).toEqual([{ staffName: '佐藤 花子', date: '2026-09-10', forceRefresh: true }]);
      expect(attendanceDays.countForTest()).toBe(0);
      expect(outbox.listAllForTest()).toEqual([]);
    });

    it('反映は月ロックに関係なく行え、個別出勤簿と勤怠集計のミラーを積み、履歴を残す', async () => {
      const result = await applyCalendarSync(deps, self, self.staffId, '2026-08-10').catch((e) => e);
      // 予定が無い日(フェイクに未設定)でも反映自体は成功する(月ロックは掛からない)
      expect(result).toMatchObject({ appointmentCount: 0, changes: [] });

      const applied = await applyCalendarSync(deps, self, self.staffId, '2026-09-10');
      expect(applied.changes).toHaveLength(13);
      const day = await getAttendanceDay(deps, self, self.staffId, '2026-09-10');
      expect(day.rowData).toMatchObject({
        C: '鈴木様',
        L: '田中様',
        H: '20',
        AG: '6',
        AI: '4.5',
        AJ: '8',
        X: '広報業務',
      });
      expect(day.changedFields).toEqual([]);
      expect(attendanceDays.history.at(-1)).toMatchObject({
        changedByStaffId: self.staffId,
        previousRowData: null,
      });
      expect(outbox.listAllForTest().map((j) => j.kind)).toEqual([
        'attendance_aggregate',
        'attendance_day',
        'attendance_aggregate',
      ]);
      expect(appLog.byAction('attendance.calendar_sync.apply')).toHaveLength(2);
    });

    it('冪等: 2回目は changedCount=0 で出勤簿の保存・履歴は増えず、勤怠集計だけ書き直す', async () => {
      await applyCalendarSync(deps, admin, otherStaffId, '2026-09-10');
      const again = await applyCalendarSync(deps, admin, otherStaffId, '2026-09-10');
      expect(again.changes).toEqual([]);
      expect(attendanceDays.history).toHaveLength(1);
      expect(outbox.listAllForTest().map((j) => j.kind)).toEqual([
        'attendance_day',
        'attendance_aggregate',
        'attendance_aggregate',
      ]);
    });

    it('手入力で直した列(changed_fields)と、カレンダーと重ならない手入力の予定は残す', async () => {
      await updateAttendanceDay(deps, self, self.staffId, '2026-09-10', {
        AO: '雨で遅延',
        AA: '電話対応',
        AB: '18:00',
        AC: '18:30',
      });
      await applyCalendarSync(deps, self, self.staffId, '2026-09-10');
      const day = await getAttendanceDay(deps, self, self.staffId, '2026-09-10');
      expect(day.rowData).toMatchObject({
        AO: '雨で遅延',
        AA: '電話対応',
        AB: '18:00',
        AC: '18:30',
        X: '広報業務',
      });
      expect(day.changedFields).toEqual(['AA', 'AB', 'AC', 'AO']);
    });

    it('予定が取得できなければ schedule_unavailable で、ERRORログを残し何も書き込まない', async () => {
      schedule.setFailure('佐藤 花子', '2026-09-11', 'Bridge timeout');
      await expect(applyCalendarSync(deps, self, self.staffId, '2026-09-11')).rejects.toMatchObject({
        code: 'schedule_unavailable',
        message: 'カレンダー予定の取得に失敗しました。(Bridge timeout)',
      });
      expect(appLog.byAction('attendance.calendar_sync.apply_failed')).toEqual([
        expect.objectContaining({ level: 'ERROR' }),
      ]);
      expect(attendanceDays.countForTest()).toBe(0);
    });

    it('勤怠集計の書き直し(refreshAttendanceAggregate)は管理者専用で、出勤簿は書き換えない', async () => {
      await expect(refreshAttendanceAggregate(deps, self, self.staffId, '2026-09-10')).rejects.toMatchObject({
        code: 'forbidden',
      });
      expect(appLog.byAction('attendance.aggregate.refresh_denied')).toHaveLength(1);

      const result = await refreshAttendanceAggregate(deps, admin, otherStaffId, '2026-09-10');
      expect(result).toMatchObject({ appointmentCount: 3, rowData: { C: '鈴木様' } });
      expect(outbox.listAllForTest().map((j) => j.kind)).toEqual(['attendance_aggregate']);
      expect((await getAttendanceDay(deps, self, self.staffId, '2026-09-10')).rowData).toEqual({});
    });
  });

  describe('runNightlyCalendarSync(夜間バッチ)', () => {
    it('全スタッフの当日(JST)分を反映し、1人の失敗で止まらず、まとめのINFOログを残す', async () => {
      schedule.setAppointments('佐藤 花子', '2026-09-25', [
        appointment({ customerName: '鈴木様', startTime: '10:00', endTime: '11:00' }),
      ]);
      schedule.setFailure('管理者 太郎', '2026-09-25', 'calendar error');

      const summary = await runNightlyCalendarSync(deps);
      expect(summary).toMatchObject({ date: '2026-09-25', succeeded: 1, failed: 1 });
      expect(summary.tenants[0]).toMatchObject({ staffCount: 2, changedStaffCount: 1, appointmentCount: 1 });
      expect(appLog.byAction('attendance.nightly_sync.staff_failed')).toEqual([
        expect.objectContaining({ level: 'ERROR', targetStaffId: admin.staffId }),
      ]);
      expect(appLog.byAction('attendance.nightly_sync.done')).toEqual([
        expect.objectContaining({
          level: 'INFO',
          details: expect.objectContaining({ succeeded: 1, failed: 1 }),
        }),
      ]);
      // システムによる自動転記は変更者なし
      expect(attendanceDays.history).toEqual([expect.objectContaining({ changedByStaffId: null })]);

      const rerun = await runNightlyCalendarSync(deps);
      expect(rerun.tenants[0]?.changedStaffCount).toBe(0);
      expect(attendanceDays.history).toHaveLength(1);
    });
  });

  describe('getAttendanceMonth', () => {
    it('月の全日を返し、合計(働いた時間を含む)と領収書の日別・月合計を集計する', async () => {
      await updateAttendanceDay(deps, self, self.staffId, '2026-09-01', { D: '16:00', E: '18:00', AN: '1' });
      await updateAttendanceDay(deps, self, self.staffId, '2026-09-02', { D: '10:00', E: '11:00' });
      const addReceipt = (timestamp: string, amount: string | null) =>
        receipts.create({
          tenantId,
          staffId: self.staffId,
          customerId: null,
          customerNameText: null,
          uploadBatchId: null,
          receiptTimestamp: new Date(timestamp),
          dedupeBlindIndex: null,
          amount: amount === null ? null : { ciphertext: `ENC:${amount}`, keyVersion: 1 },
          storeName: null,
          handoffText: null,
          fileKey: 'k',
          contentType: 'image/jpeg',
        });
      await addReceipt('2026-09-01T01:00:00Z', '1,200');
      // JSTでは9/2(UTCでは9/1)
      await addReceipt('2026-09-01T16:00:00Z', '300');
      await addReceipt('2026-09-02T02:00:00Z', null);
      // JSTでは10/1なので対象外
      await addReceipt('2026-09-30T15:30:00Z', '999');

      const month = await getAttendanceMonth(deps, self, self.staffId, '2026-09');
      expect(month.days).toHaveLength(30);
      expect(month.days[2]).toMatchObject({ businessDate: '2026-09-03', rowData: {} });
      expect(month.totals).toMatchObject({
        laborMinutes: 120,
        overtimeMinutes: 60,
        workedMinutes: 180,
        shoppingErrandTotal: 1,
      });
      expect(month.receipts).toEqual({ byDay: { '2026-09-01': 1200, '2026-09-02': 300 }, total: 1500 });
      expect(month.staffName).toBe('佐藤 花子');
    });

    it('年月の形式が不正なら invalid_request', async () => {
      await expect(getAttendanceMonth(deps, self, self.staffId, '2026-13')).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });
  });

  describe('getAttendanceScheduleEvents(週間予定)', () => {
    it('期間内の記録を日付順・枠順のイベントにし、31日を超える指定は拒否する', async () => {
      await updateAttendanceDay(deps, self, self.staffId, '2026-09-11', { X: 'MTG', Y: '14:00', Z: '15:00' });
      await updateAttendanceDay(deps, self, self.staffId, '2026-09-10', {
        C: '佐藤様',
        D: '09:00',
        E: '10:00',
      });
      const events = await getAttendanceScheduleEvents(deps, self, self.staffId, '2026-09-07', '2026-09-13');
      expect(events.map((e) => [e.date, e.slotKey])).toEqual([
        ['2026-09-10', 'slot1'],
        ['2026-09-11', 'office1'],
      ]);
      await expect(
        getAttendanceScheduleEvents(deps, self, self.staffId, '2026-09-01', '2026-10-02'),
      ).rejects.toMatchObject({ code: 'invalid_request' });
    });
  });
});
