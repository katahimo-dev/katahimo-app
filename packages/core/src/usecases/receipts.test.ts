import { beforeEach, describe, expect, it } from 'vitest';
import type { UploadReceiptsInput } from './receipts';
import { parseAmountYen, uploadReceipts } from './receipts';
import type { Actor } from './requestMeta';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

/** JPEGの先頭バイト(FF D8 FF E0 …)だけの最小のデータ。 */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
/** 宣言は JPEG だが中身は PNG(拡張子と種類は中身から決める)。 */
const PNG_AS_JPEG = `data:image/jpeg;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64')}`;

describe('uploadReceipts', () => {
  let ctx: TestContext;
  let staff: Actor;
  let other: Actor;
  let customerId: string;

  const input = (overrides: Partial<UploadReceiptsInput> = {}): UploadReceiptsInput => ({
    customerId,
    images: [
      { data: JPEG, amount: '1,200', storeName: 'コンビニ' },
      { data: JPEG, amount: '300', storeName: '駐車場' },
    ],
    fallbackTimestamp: '2026/09/25 10:00:00',
    handoffText: '申し送り',
    ...overrides,
  });

  beforeEach(async () => {
    ctx = createTestContext();
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    other = (await ctx.addStaff('鈴木 次郎', 'jiro@example.com')).actor;
    customerId = await ctx.addCustomer('佐藤 花子');
  });

  it('画像を保存し、1トランザクションで記録とミラーを積み、通知する', async () => {
    const result = await uploadReceipts(ctx.deps, staff, input());
    expect(result).toMatchObject({ uploadedCount: 2, duplicateCount: 0 });
    expect(ctx.data().receipts.map((r) => r.amountYen)).toEqual([1200, 300]);
    expect(ctx.data().files).toHaveLength(2);
    expect(ctx.storage.files.size).toBe(2);
    expect(ctx.data().outbox.map((m) => m.topic)).toEqual(['mirror.receipt', 'mirror.receipt']);
    expect(ctx.notifier.notifications).toHaveLength(1);
  });

  it('同じ内容の再登録は重複として登録せず、保存した画像も消す', async () => {
    await uploadReceipts(ctx.deps, staff, input());
    const again = await uploadReceipts(ctx.deps, staff, input());
    expect(again).toMatchObject({ uploadedCount: 0, duplicateCount: 2, uploadBatchId: null });
    expect(ctx.data().receipts).toHaveLength(2);
    expect(ctx.data().files).toHaveLength(2);
    expect(ctx.storage.files.size).toBe(2);
    expect(ctx.notifier.notifications).toHaveLength(1);
  });

  it('同じ操作の中の同じ内容(往復の運賃等)は全て登録する', async () => {
    const same = { data: JPEG, amount: '500', storeName: '電車' };
    expect((await uploadReceipts(ctx.deps, staff, input({ images: [same, same] }))).uploadedCount).toBe(2);
  });

  it('一般スタッフが他人の名義を指定しても本人の名義になる', async () => {
    await uploadReceipts(ctx.deps, staff, input({ requestedStaffId: other.staffId }));
    expect(ctx.data().receipts.every((r) => r.staffId === staff.staffId)).toBe(true);
  });

  it('拡張子・種類は宣言ではなく中身から決める', async () => {
    await uploadReceipts(
      ctx.deps,
      staff,
      input({ images: [{ data: PNG_AS_JPEG, amount: '1', storeName: 'a' }] }),
    );
    const [key] = [...ctx.storage.files.keys()];
    expect(key).toMatch(/\.png$/);
    expect(ctx.data().files[0]?.contentType).toBe('image/png');
  });

  it('トランザクションが失敗したら保存した画像を消す(孤立したファイルを残さない)', async () => {
    await expect(
      uploadReceipts(ctx.deps, staff, input({ customerId: '00000000-0000-7000-8000-00000000ffff' })),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(ctx.storage.files.size).toBe(0);
    expect(ctx.data().uploads).toHaveLength(0);
  });

  it('画像の形式が正しくなければ validation_failed', async () => {
    await expect(
      uploadReceipts(ctx.deps, staff, input({ images: [{ data: 'data:image/gif;base64,R0lGOD' }] })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('parseAmountYen', () => {
  it('区切り・円記号を除いて整数にする', () => {
    expect(parseAmountYen('1,200円')).toBe(1200);
    expect(parseAmountYen('¥300')).toBe(300);
    expect(parseAmountYen('abc')).toBeNull();
    expect(parseAmountYen('')).toBeNull();
  });
});
