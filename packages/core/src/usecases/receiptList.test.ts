import { beforeEach, describe, expect, it } from 'vitest';
import {
  decodeReceiptCursor,
  encodeReceiptCursor,
  exportReceipts,
  getReceiptImage,
  listReceipts,
  type ReceiptListCriteria,
} from './receiptList';
import { uploadReceipts } from './receipts';
import type { Actor } from './requestMeta';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

/** JPEGの先頭バイト(FF D8 FF E0 …)だけの最小のデータ。 */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('領収書の一覧・画像', () => {
  let ctx: TestContext;
  let staff: Actor;
  let other: Actor;
  let coordinator: Actor;
  let admin: Actor;
  let customerId: string;

  const upload = (actor: Actor, receiptDate: string, amount: string | null, extra = {}) =>
    uploadReceipts(ctx.deps, actor, {
      customerId,
      images: [{ data: JPEG, amount, storeName: `店${receiptDate}`, receiptDate }],
      fallbackTimestamp: '2026/09/25 10:00:00',
      handoffText: '申し送りです',
      ...extra,
    });

  const criteria = (actor: Actor, overrides: Partial<ReceiptListCriteria> = {}) => ({
    yearMonth: '2026-09',
    allStaff: false,
    targetStaffId: actor.staffId,
    limit: 50,
    ...overrides,
  });

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    coordinator = (await ctx.addStaff('調整 三郎', 'saburo@example.com', 'coordinator')).actor;
    admin = (await ctx.addStaff('管理 花子', 'hanako@example.com', 'admin')).actor;
    customerId = await ctx.addCustomer('佐藤 花子');
    await upload(staff, '2026/09/10 12:00', '1,200');
    await upload(staff, '2026/09/01 00:30', null);
    // 8/31 23:30(JST)は8月。9/30 23:59 は9月、10/1 0:00 は10月
    await upload(staff, '2026/08/31 23:30', '999');
    await upload(staff, '2026/09/30 23:59', '300');
    await upload(staff, '2026/10/01 00:00', '777');
    await upload(other, '2026/09/15 09:00', '5,000');
  });

  it('本人の月の領収書を新しい順に、月全体の件数・合計つきで返す(JSTの月の境界)', async () => {
    const page = await listReceipts(ctx.deps, staff, criteria(staff));
    expect(page.receipts.map((r) => r.amountYen)).toEqual([300, 1200, null]);
    expect(page.summary).toEqual({ count: 3, totalYen: 1500, noAmountCount: 1 });
    expect(page.staff).toEqual({ id: staff.staffId, name: '山田 太郎' });
    expect(page.receipts[0]).toMatchObject({
      staffName: '山田 太郎',
      customerId,
      customerName: '佐藤 花子',
      handoffText: '申し送りです',
      imageContentType: 'image/jpeg',
    });
    expect(page.nextCursor).toBeNull();
    // 本人の閲覧は記録しない
    expect(ctx.appLog.byAction('receipt.list.viewed')).toEqual([]);
  });

  it('keyset ページングで続きを読み、合計はページではなく月全体', async () => {
    const first = await listReceipts(ctx.deps, staff, { ...criteria(staff), limit: 2 });
    expect(first.receipts).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listReceipts(ctx.deps, staff, {
      ...criteria(staff),
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.receipts.map((r) => r.amountYen)).toEqual([null]);
    expect(second.nextCursor).toBeNull();
    expect(second.summary.totalYen).toBe(1500);
  });

  it('一般スタッフは他人・全スタッフ分を見られない(403)', async () => {
    await expect(
      listReceipts(ctx.deps, staff, criteria(staff, { targetStaffId: other.staffId })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listReceipts(ctx.deps, staff, criteria(staff, { allStaff: true }))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(ctx.appLog.byAction('receipt.list.view_denied')).toMatchObject([
      { level: 'WARN', actorStaffId: staff.staffId, targetStaffId: other.staffId },
      { level: 'WARN', actorStaffId: staff.staffId, targetStaffId: null, details: { allStaff: true } },
    ]);
  });

  it('コーディネーター・管理者は他のスタッフ・全スタッフ分を見られ、最初のページだけ閲覧を記録する', async () => {
    const page = await listReceipts(
      ctx.deps,
      coordinator,
      criteria(coordinator, { targetStaffId: other.staffId }),
    );
    expect(page.receipts.map((r) => r.amountYen)).toEqual([5000]);
    const all = await listReceipts(ctx.deps, admin, { ...criteria(admin, { allStaff: true }), limit: 3 });
    expect(all.staff).toBeNull();
    expect(all.summary).toEqual({ count: 4, totalYen: 6500, noAmountCount: 1 });
    await listReceipts(ctx.deps, admin, {
      ...criteria(admin, { allStaff: true }),
      limit: 3,
      cursor: all.nextCursor ?? undefined,
    });
    const logs = ctx.appLog.byAction('receipt.list.viewed');
    expect(logs.map((l) => [l.actorStaffId, l.targetStaffId, l.details])).toEqual([
      [coordinator.staffId, other.staffId, { month: '2026-09', allStaff: false, count: 1 }],
      [admin.staffId, null, { month: '2026-09', allStaff: true, count: 4 }],
    ]);
  });

  it('お客様で絞り込める。お客様の指定なしは入力された氏名を出す', async () => {
    await uploadReceipts(ctx.deps, staff, {
      customerId: null,
      customerNameText: '未登録 さん',
      images: [{ data: JPEG, amount: '100', storeName: '店', receiptDate: '2026/09/20 10:00' }],
      fallbackTimestamp: '2026/09/20 10:00:00',
      handoffText: '',
    });
    const page = await listReceipts(ctx.deps, staff, criteria(staff));
    expect(page.receipts.find((r) => r.amountYen === 100)).toMatchObject({
      customerId: null,
      customerName: '未登録 さん',
      handoffText: null,
    });
    const filtered = await listReceipts(ctx.deps, staff, criteria(staff, { customerId }));
    expect(filtered.summary.count).toBe(3);
  });

  it('存在しないスタッフ・お客様は 404、月・続きの位置の誤りは 400', async () => {
    const missing = '00000000-0000-7000-8000-999999999999';
    await expect(
      listReceipts(ctx.deps, admin, criteria(admin, { targetStaffId: missing })),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      listReceipts(ctx.deps, admin, criteria(admin, { customerId: missing })),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      listReceipts(ctx.deps, staff, criteria(staff, { yearMonth: '2026-13' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(listReceipts(ctx.deps, staff, { ...criteria(staff), cursor: 'xxx' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('続きの位置は往復できる', () => {
    const position = {
      receiptedAt: new Date('2026-09-01T00:00:00Z'),
      id: '0192f1d2-0000-7000-8000-000000000001',
    };
    expect(decodeReceiptCursor(encodeReceiptCursor(position))).toEqual(position);
  });

  it('CSV は管理者・コーディネーターだけ。全件を読み、ダウンロードを記録する', async () => {
    await expect(exportReceipts(ctx.deps, staff, criteria(staff))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(ctx.appLog.byAction('receipt.list.export_denied')).toHaveLength(1);
    const exported = await exportReceipts(ctx.deps, coordinator, criteria(coordinator, { allStaff: true }));
    const batches: number[] = [];
    for await (const batch of exported.receipts()) batches.push(batch.length);
    expect(batches).toEqual([4]);
    expect(ctx.appLog.byAction('receipt.list.exported')).toHaveLength(1);
  });

  it('画像は本人・管理者・コーディネーターが読め、一般スタッフの他人の画像は 403(WARN)', async () => {
    const [mine] = (await listReceipts(ctx.deps, staff, criteria(staff))).receipts;
    const id = mine?.id ?? '';
    const image = await getReceiptImage(ctx.deps, staff, id);
    expect(image.contentType).toBe('image/jpeg');
    expect(image.bytes[0]).toBe(0xff);
    await expect(getReceiptImage(ctx.deps, coordinator, id)).resolves.toMatchObject({
      contentType: 'image/jpeg',
    });
    await expect(getReceiptImage(ctx.deps, admin, id)).resolves.toMatchObject({ contentType: 'image/jpeg' });
    await expect(getReceiptImage(ctx.deps, other, id)).rejects.toMatchObject({ code: 'forbidden' });
    expect(ctx.appLog.byAction('receipt.image.view_denied')).toMatchObject([
      { level: 'WARN', actorStaffId: other.staffId, targetStaffId: staff.staffId },
    ]);
  });

  it('無い領収書・消えた画像・画像でない中身は 404', async () => {
    await expect(
      getReceiptImage(ctx.deps, staff, '00000000-0000-7000-8000-999999999999'),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [mine] = (await listReceipts(ctx.deps, staff, criteria(staff))).receipts;
    const file = ctx
      .data()
      .files.find((f) => ctx.data().receipts.some((r) => r.id === mine?.id && r.fileId === f.id));
    ctx.storage.files.set(file?.storageKey ?? '', {
      contentType: 'image/jpeg',
      body: new TextEncoder().encode('<svg/>'),
    });
    await expect(getReceiptImage(ctx.deps, staff, mine?.id ?? '')).rejects.toMatchObject({
      code: 'not_found',
    });
    ctx.storage.files.delete(file?.storageKey ?? '');
    await expect(getReceiptImage(ctx.deps, staff, mine?.id ?? '')).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(ctx.appLog.byAction('receipt.image.unavailable').map((l) => l.details?.reason)).toEqual([
      'unsupported_type',
      'missing',
    ]);
  });
});
