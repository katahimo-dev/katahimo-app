import { beforeEach, describe, expect, it } from 'vitest';
import { getAttendanceMonth } from './attendance/month';
import { cancelReceipt } from './receiptCancel';
import { exportReceipts, listReceipts, type ReceiptListCriteria } from './receiptList';
import { uploadReceipts } from './receipts';
import type { Actor } from './requestMeta';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('領収書の取消(論理削除)', () => {
  let ctx: TestContext;
  let staff: Actor;
  let other: Actor;
  let coordinator: Actor;
  let admin: Actor;
  let customerId: string;

  /** 領収書を1枚登録し、その行を返す。 */
  const upload = async (
    actor: Actor,
    receiptDate: string,
    options: { amount?: string; storeName?: string; companyPaid?: boolean } = {},
  ) => {
    const storeName = options.storeName ?? `店${receiptDate}`;
    await uploadReceipts(ctx.deps, actor, {
      customerId,
      images: [
        {
          data: JPEG,
          amount: options.amount ?? '500',
          storeName,
          receiptDate,
          companyPaid: options.companyPaid,
        },
      ],
      fallbackTimestamp: '2026/09/25 10:00:00',
      handoffText: '',
    });
    const row = ctx
      .data()
      .receipts.filter((r) => r.storeName === storeName && r.cancelledAt === null)
      .at(-1);
    if (!row) throw new Error('登録できませんでした');
    return row;
  };

  const criteria = (actor: Actor, overrides: Partial<ReceiptListCriteria> = {}) => ({
    yearMonth: '2026-09',
    allStaff: false,
    targetStaffId: actor.staffId,
    limit: 50,
    ...overrides,
  });

  /** 今(テナントの日本時間)を 'YYYY-MM-DD HH:mm' で決める。 */
  const setNow = (jst: string) => {
    ctx.clock.now = new Date(`${jst.replace(' ', 'T')}:00+09:00`);
  };

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    coordinator = (await ctx.addStaff('調整 三郎', 'saburo@example.com', 'coordinator')).actor;
    admin = (await ctx.addStaff('管理 花子', 'hanako@example.com', 'admin')).actor;
    customerId = await ctx.addCustomer('佐藤 花子');
    setNow('2026-09-25 12:00');
  });

  it('本人が取消すと行は残り、取消の日時・取消した人・理由が入って版が上がる', async () => {
    const receipt = await upload(staff, '2026/09/24 10:00', { storeName: '駐車場', companyPaid: true });
    const view = await cancelReceipt(ctx.deps, staff, {
      receiptId: receipt.id,
      reason: '金額を間違えた',
      rowVersion: receipt.rowVersion,
    });
    expect(view).toMatchObject({
      id: receipt.id,
      companyPaid: true,
      rowVersion: 2,
      cancellable: false,
      cancellation: {
        cancelledAt: '2026-09-25T03:00:00.000Z',
        cancelledByName: '山田 太郎',
        reason: '金額を間違えた',
      },
    });
    const stored = ctx.data().receipts.find((r) => r.id === receipt.id);
    expect(stored).toMatchObject({
      cancelledBy: staff.staffId,
      cancelReason: '金額を間違えた',
      rowVersion: 2,
    });
    expect(ctx.appLog.byAction('receipt.cancelled')).toMatchObject([
      {
        level: 'INFO',
        actorStaffId: staff.staffId,
        targetStaffId: null,
        details: { receiptId: receipt.id, withReason: true },
      },
    ]);
    // 経理が見る領収書の通知先へ知らせる(本人の取消なので「取消した人」は書かない)
    expect(ctx.notifier.notifications.at(-1)).toMatchObject({ channel: 'receipt' });
    expect(ctx.notifier.notifications.at(-1)?.text).toBe(
      '【領収書取消】\n担当: 山田 太郎\n顧客名: 佐藤 花子\n日時: 2026/09/24 10:00\n名称: 駐車場 / 金額: 500円 / 会社負担(お客様に請求しない)\n取消の理由: 金額を間違えた',
    );
    // スプレッドシートへのミラーには積まない(登録の1件だけ)
    expect(ctx.data().outbox.filter((m) => m.topic === 'mirror.receipt')).toHaveLength(1);
  });

  it('理由は任意(空白だけなら理由なし)', async () => {
    const receipt = await upload(staff, '2026/09/25 09:00');
    const view = await cancelReceipt(ctx.deps, staff, { receiptId: receipt.id, reason: '  ', rowVersion: 1 });
    expect(view.cancellation?.reason).toBeNull();
    expect(ctx.appLog.byAction('receipt.cancelled')[0]?.details).toMatchObject({ withReason: false });
  });

  it('一般スタッフは他人の領収書を取消せない(403 + WARN)。コーディネーター・管理者は取消せる', async () => {
    const receipt = await upload(other, '2026/09/24 10:00');
    await expect(
      cancelReceipt(ctx.deps, staff, { receiptId: receipt.id, rowVersion: 1 }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(ctx.appLog.byAction('receipt.cancel_denied')).toMatchObject([
      { level: 'WARN', actorStaffId: staff.staffId, targetStaffId: other.staffId },
    ]);
    expect(ctx.data().receipts.find((r) => r.id === receipt.id)?.cancelledAt).toBeNull();

    const view = await cancelReceipt(ctx.deps, coordinator, { receiptId: receipt.id, rowVersion: 1 });
    expect(view.cancellation?.cancelledByName).toBe('調整 三郎');
    expect(ctx.appLog.byAction('receipt.cancelled')[0]).toMatchObject({
      actorStaffId: coordinator.staffId,
      targetStaffId: other.staffId,
    });
    expect(ctx.notifier.notifications.at(-1)?.text).toContain('取消した人: 調整 三郎');
  });

  it('取消済みは 409 already_cancelled、版が違えば 409 stale_row_version(何も書かない)', async () => {
    const receipt = await upload(staff, '2026/09/25 09:00');
    await expect(
      cancelReceipt(ctx.deps, staff, { receiptId: receipt.id, rowVersion: 7 }),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'stale_row_version' });
    expect(ctx.data().receipts.find((r) => r.id === receipt.id)?.cancelledAt).toBeNull();
    await cancelReceipt(ctx.deps, staff, { receiptId: receipt.id, rowVersion: 1 });
    await expect(
      cancelReceipt(ctx.deps, staff, { receiptId: receipt.id, rowVersion: 2 }),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'already_cancelled' });
    expect(ctx.appLog.byAction('receipt.cancelled')).toHaveLength(1);
  });

  it('無い領収書は 404', async () => {
    await expect(
      cancelReceipt(ctx.deps, staff, { receiptId: '00000000-0000-7000-8000-00000000ffff', rowVersion: 1 }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('スタッフ・コーディネーターは領収書の日付の2日後まで。期間の外は 400 locked + WARN', async () => {
    const d23 = await upload(staff, '2026/09/23 10:00');
    const d22 = await upload(staff, '2026/09/22 10:00');
    // 今日は 9/25: 9/23 は D+2(取消せる)、9/22 は D+3(取消せない)
    await expect(cancelReceipt(ctx.deps, staff, { receiptId: d22.id, rowVersion: 1 })).rejects.toMatchObject({
      code: 'locked',
      reason: 'deadline_passed',
    });
    await expect(
      cancelReceipt(ctx.deps, coordinator, { receiptId: d22.id, rowVersion: 1 }),
    ).rejects.toMatchObject({ code: 'locked', reason: 'deadline_passed' });
    expect(ctx.appLog.byAction('receipt.cancel_refused')).toMatchObject([
      { level: 'WARN', actorStaffId: staff.staffId, details: { reason: 'deadline_passed' } },
      { level: 'WARN', actorStaffId: coordinator.staffId, details: { reason: 'deadline_passed' } },
    ]);
    await cancelReceipt(ctx.deps, staff, { receiptId: d23.id, rowVersion: 1 });
    // 管理者は同じ月なら期限を過ぎても取消せる
    await cancelReceipt(ctx.deps, admin, { receiptId: d22.id, rowVersion: 1 });
  });

  it('月の最終日はスタッフ・コーディネーターは取消せず、管理者は取消せる。月をまたぐと管理者も取消せない', async () => {
    const receipt = await upload(staff, '2026/09/29 10:00');
    setNow('2026-09-30 23:30');
    for (const actor of [staff, coordinator]) {
      await expect(
        cancelReceipt(ctx.deps, actor, { receiptId: receipt.id, rowVersion: 1 }),
      ).rejects.toMatchObject({ code: 'locked', reason: 'month_end' });
    }
    const lastDay = await upload(other, '2026/09/30 10:00');
    await cancelReceipt(ctx.deps, admin, { receiptId: lastDay.id, rowVersion: 1 });

    setNow('2026-10-01 00:00');
    await expect(
      cancelReceipt(ctx.deps, admin, { receiptId: receipt.id, rowVersion: 1 }),
    ).rejects.toMatchObject({ code: 'locked', reason: 'other_month' });
  });

  it('出勤簿が締め済みの月は管理者も取消せない', async () => {
    const receipt = await upload(staff, '2026/09/25 09:00');
    ctx.data().lockedPeriods.push({ staffId: staff.staffId, yearMonth: '2026-09' });
    await expect(
      cancelReceipt(ctx.deps, admin, { receiptId: receipt.id, rowVersion: 1 }),
    ).rejects.toMatchObject({ code: 'locked', reason: 'period_locked' });
    const page = await listReceipts(ctx.deps, admin, criteria(admin, { targetStaffId: staff.staffId }));
    expect(page.receipts[0]?.cancellable).toBe(false);
  });

  it('一覧には灰色で残り(取消の情報つき)、合計・件数・CSV・今月のまとめからは除く', async () => {
    await upload(staff, '2026/09/24 10:00', { amount: '1,000', storeName: 'コンビニ' });
    await upload(staff, '2026/09/24 11:00', { amount: '600', storeName: '駐車場', companyPaid: true });
    const mistaken = await upload(staff, '2026/09/24 12:00', { amount: '9,999', storeName: '間違い' });
    await cancelReceipt(ctx.deps, staff, { receiptId: mistaken.id, reason: '二重に撮った', rowVersion: 1 });

    const page = await listReceipts(ctx.deps, staff, criteria(staff));
    expect(page.receipts.map((r) => [r.storeName, r.cancellation?.reason ?? null])).toEqual([
      ['間違い', '二重に撮った'],
      ['駐車場', null],
      ['コンビニ', null],
    ]);
    expect(page.summary).toEqual({
      count: 2,
      totalYen: 1600,
      companyPaidYen: 600,
      customerBillableYen: 1000,
      noAmountCount: 0,
      cancelledCount: 1,
    });

    const month = await getAttendanceMonth(ctx.deps, staff, staff.staffId, '2026-09');
    expect(month.receipts).toMatchObject({ total: 1600, companyPaid: 600, customerBillable: 1000 });

    const exported = await exportReceipts(ctx.deps, admin, { ...criteria(admin), allStaff: true });
    const rows = [];
    for await (const batch of exported.receipts()) rows.push(...batch);
    expect(rows.map((r) => r.storeName)).toEqual(['駐車場', 'コンビニ']);
  });

  it('取消した領収書は重複の判定に入らない(同じ内容を登録し直せる)', async () => {
    const receipt = await upload(staff, '2026/09/24 10:00', { amount: '1,200', storeName: 'コンビニ' });
    // 取消す前は同じ内容を重複として弾く
    const again = () =>
      uploadReceipts(ctx.deps, staff, {
        customerId,
        images: [{ data: JPEG, amount: '1,200', storeName: 'コンビニ', receiptDate: '2026/09/24 10:00' }],
        fallbackTimestamp: '2026/09/25 10:00:00',
        handoffText: '',
      });
    expect(await again()).toMatchObject({ uploadedCount: 0, duplicateCount: 1 });
    await cancelReceipt(ctx.deps, staff, { receiptId: receipt.id, rowVersion: 1 });
    expect(await again()).toMatchObject({ uploadedCount: 1, duplicateCount: 0 });
    // 登録し直した分は重複として弾く
    expect(await again()).toMatchObject({ uploadedCount: 0, duplicateCount: 1 });
  });

  it('一覧の cancellable は見ている人の役割・本人かどうか・期間で決まる', async () => {
    await upload(staff, '2026/09/25 09:00', { storeName: '今日' });
    await upload(staff, '2026/09/20 09:00', { storeName: '5日前' });
    await upload(other, '2026/09/25 09:00', { storeName: '他人の今日' });
    const flags = async (actor: Actor) => {
      const page = await listReceipts(ctx.deps, actor, criteria(actor, { allStaff: actor !== staff }));
      return Object.fromEntries(page.receipts.map((r) => [r.storeName, r.cancellable]));
    };
    expect(await flags(staff)).toEqual({ 今日: true, '5日前': false });
    expect(await flags(coordinator)).toEqual({ 今日: true, '5日前': false, 他人の今日: true });
    expect(await flags(admin)).toEqual({ 今日: true, '5日前': true, 他人の今日: true });
  });
});
