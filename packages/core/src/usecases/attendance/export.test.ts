import { beforeEach, describe, expect, it } from 'vitest';
import { cancelReceipt } from '../receiptCancel';
import { uploadReceipts } from '../receipts';
import type { Actor } from '../requestMeta';
import type { TestContext } from '../testContext';
import { createTestContext } from '../testContext';
import { updateAttendanceDay } from './day';
import { exportAllStaffAttendance, exportAttendance } from './export';
import { getAttendanceMonth } from './month';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('出勤簿の書き出し', () => {
  let ctx: TestContext;
  let staff: Actor;
  let other: Actor;
  let coordinator: Actor;
  let admin: Actor;
  let customerId: string;

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    coordinator = (await ctx.addStaff('調整 役', 'coord@example.com', 'coordinator')).actor;
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    customerId = await ctx.addCustomer('佐藤 花子');
    await updateAttendanceDay(ctx.deps, staff, staff.staffId, '2026-09-24', {
      C: '佐藤様',
      D: '09:00',
      E: '12:00',
      AG: '6',
    });
    await uploadReceipts(ctx.deps, staff, {
      customerId,
      images: [
        { data: JPEG, amount: '1,200', storeName: 'コンビニ' },
        { data: JPEG, amount: '', storeName: '駐車場', companyPaid: true },
        { data: JPEG, amount: '400', storeName: 'コインパーキング', companyPaid: true },
      ],
      fallbackTimestamp: '2026/09/25 10:05:00',
      handoffText: '申し送り',
    });
    // 取消した領収書は明細にも合計にも入らない
    await uploadReceipts(ctx.deps, staff, {
      customerId,
      images: [{ data: JPEG, amount: '9,999', storeName: '間違い' }],
      fallbackTimestamp: '2026/09/25 11:00:00',
      handoffText: '',
    });
    const mistaken = ctx.data().receipts.find((r) => r.storeName === '間違い');
    if (!mistaken) throw new Error('fixture');
    await cancelReceipt(ctx.deps, staff, { receiptId: mistaken.id, rowVersion: mistaken.rowVersion });
  });

  it('1か月分は今月のまとめと同じ値に、領収書の明細(お客様・時刻・申し送りは束の最初の1件)を添える', async () => {
    const exported = await exportAttendance(ctx.deps, staff, staff.staffId, {
      kind: 'month',
      yearMonth: '2026-09',
    });
    const month = await getAttendanceMonth(ctx.deps, staff, staff.staffId, '2026-09');
    expect(exported).toMatchObject({
      staffId: staff.staffId,
      staffName: '山田 太郎',
      staffEmail: 'taro@example.com',
    });
    expect(exported.months).toHaveLength(1);
    expect(exported.months[0]?.month).toEqual(month);
    expect(exported.months[0]?.receipts).toEqual([
      {
        businessDate: '2026-09-25',
        time: '10:05',
        customerName: '佐藤 花子',
        storeName: 'コンビニ',
        amountYen: 1200,
        companyPaid: false,
        handoffText: '申し送り',
      },
      {
        businessDate: '2026-09-25',
        time: '10:05',
        customerName: '佐藤 花子',
        storeName: '駐車場',
        amountYen: null,
        companyPaid: true,
        handoffText: '',
      },
      {
        businessDate: '2026-09-25',
        time: '10:05',
        customerName: '佐藤 花子',
        storeName: 'コインパーキング',
        amountYen: 400,
        companyPaid: true,
        handoffText: '',
      },
    ]);
    // 会社負担もスタッフへの支払い(合計)に入り、お客様に請求するのは会社負担を除いた分
    expect(month.receipts).toEqual({
      byDay: { '2026-09-25': 1600 },
      total: 1600,
      companyPaidByDay: { '2026-09-25': 400 },
      companyPaid: 400,
      customerBillable: 1200,
    });
    expect(ctx.appLog.entries.filter((e) => e.action === 'attendance.export.downloaded')).toEqual([
      expect.objectContaining({
        level: 'INFO',
        actorStaffId: staff.staffId,
        targetStaffId: staff.staffId,
        details: { period: 'month', yearMonth: '2026-09' },
      }),
    ]);
  });

  it('年度は4月〜翌3月の12か月', async () => {
    const exported = await exportAttendance(ctx.deps, admin, staff.staffId, {
      kind: 'fiscal_year',
      fiscalYear: 2026,
    });
    expect(exported.months.map((m) => m.month.yearMonth)).toEqual([
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    expect(exported.months[5]?.month.totals.laborMinutes).toBe(120);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      action: 'attendance.export.downloaded',
      actorStaffId: admin.staffId,
      targetStaffId: staff.staffId,
      details: { period: 'fiscal_year', fiscalYear: 2026 },
    });
  });

  it('一般スタッフは他のスタッフの出勤簿を書き出せない。コーディネーター・管理者は書き出せる', async () => {
    await expect(
      exportAttendance(ctx.deps, other, staff.staffId, { kind: 'month', yearMonth: '2026-09' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    for (const actor of [coordinator, admin]) {
      const exported = await exportAttendance(ctx.deps, actor, staff.staffId, {
        kind: 'month',
        yearMonth: '2026-09',
      });
      expect(exported.months[0]?.receipts).toHaveLength(3);
    }
  });

  it('月・年度の指定が不正なら validation_failed', async () => {
    await expect(
      exportAttendance(ctx.deps, staff, staff.staffId, { kind: 'month', yearMonth: '2026-13' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      exportAttendance(ctx.deps, staff, staff.staffId, { kind: 'fiscal_year', fiscalYear: 1999 }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('全員分は管理者だけ。その月に在籍している全員(月の途中で辞めた人を含み、月の前に辞めた人は含まない)', async () => {
    for (const actor of [staff, coordinator]) {
      await expect(exportAllStaffAttendance(ctx.deps, actor, '2026-09')).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    ctx.setRetiredOn(other.staffId, '2026-09-15');
    ctx.setRetiredOn(coordinator.staffId, '2026-09-01');
    const exported = await exportAllStaffAttendance(ctx.deps, admin, '2026-09');
    expect(exported.map((s) => s.staffName).sort()).toEqual(['山田 太郎', '管理 者', '鈴木 次郎'].sort());
    const taro = exported.find((s) => s.staffId === staff.staffId);
    expect(taro?.months[0]?.month.totals.laborMinutes).toBe(120);
    expect(taro?.months[0]?.receipts.map((r) => r.amountYen)).toEqual([1200, null, 400]);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'attendance.export_all.downloaded',
      actorStaffId: admin.staffId,
      targetStaffId: null,
      details: { yearMonth: '2026-09', staffCount: 3 },
    });
  });
});
