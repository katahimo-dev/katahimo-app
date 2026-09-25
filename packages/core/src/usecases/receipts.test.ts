import { beforeEach, describe, expect, it } from 'vitest';
import { resolveReceiptFallbackTimestamp } from '../domain';
import { registerStaff } from './auth';
import { createCustomer } from './customers';
import type { ReceiptDeps, UploadReceiptsInput } from './receipts';
import { uploadReceipts } from './receipts';
import {
  FakeAppLogPort,
  FakeBlindIndexPort,
  FakeCryptoPort,
  FakeCustomerRepository,
  FakeFamilyMemberRepository,
  FakeNotifierPort,
  FakeOutboxRepository,
  FakePasswordHasherPort,
  FakeReceiptRepository,
  FakeStaffRepository,
  FakeStoragePort,
} from './testDoubles';

/** JPEGの先頭バイト(FF D8 FF E0 …)だけの最小のデータ。 */
const IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('uploadReceipts', () => {
  const tenantId = 'tenant-1';
  let deps: ReceiptDeps;
  let receipts: FakeReceiptRepository;
  let notifier: FakeNotifierPort;
  let crypto: FakeCryptoPort;
  let staffId: string;
  let otherStaffId: string;
  let customerId: string;

  const input = (overrides: Partial<UploadReceiptsInput> = {}): UploadReceiptsInput => ({
    actor: { staffId, isAdmin: false },
    customerId,
    images: [
      { data: IMAGE, amount: '1200', storeName: 'コンビニ' },
      { data: IMAGE, amount: '300', storeName: '駐車場' },
    ],
    fallbackTimestamp: '2026/08/30 10:00:00',
    handoffText: ' 鍵はポストへ ',
    ...overrides,
  });

  beforeEach(async () => {
    const staff = new FakeStaffRepository();
    const customers = new FakeCustomerRepository();
    crypto = new FakeCryptoPort();
    receipts = new FakeReceiptRepository();
    notifier = new FakeNotifierPort();
    const hasher = new FakePasswordHasherPort();
    staffId = (
      await registerStaff(
        { staff, passwordHasher: hasher },
        { tenantId, name: '佐藤 花子', email: 'h@example.com', isAdmin: false },
      )
    ).id;
    otherStaffId = (
      await registerStaff(
        { staff, passwordHasher: hasher },
        { tenantId, name: '鈴木 次郎', email: 'j@example.com', isAdmin: false },
      )
    ).id;
    customerId = (
      await createCustomer(
        { customers, familyMembers: new FakeFamilyMemberRepository(), crypto },
        { tenantId, name: '田中 一郎' },
      )
    ).id;
    deps = {
      receipts,
      staff,
      customers,
      crypto,
      blindIndex: new FakeBlindIndexPort(),
      storage: new FakeStoragePort(),
      notifier,
      mirror: new FakeOutboxRepository(),
      appLog: new FakeAppLogPort(),
    };
  });

  it('同じ操作で登録した行は同じバッチIDを持ち、申し送りは先頭行だけに保存される', async () => {
    const result = await uploadReceipts(deps, tenantId, input());
    if (!result.ok) throw new Error('unreachable');
    expect(result.uploadedCount).toBe(2);

    const rows = await Promise.all(['receipt-1', 'receipt-2'].map((id) => receipts.findById(tenantId, id)));
    expect(rows.map((r) => r?.uploadBatchId)).toEqual([result.uploadBatchId, result.uploadBatchId]);
    expect(
      rows[0]?.handoffText && (await crypto.decrypt(tenantId, rows[0].handoffText, 'receipts.handoff_text')),
    ).toBe('鍵はポストへ');
    expect(rows[1]?.handoffText).toBeNull();
  });

  it('既に登録済みの領収書は重複として登録せず、申し送りは実際に登録した最初の行に付く', async () => {
    await uploadReceipts(
      deps,
      tenantId,
      input({ images: [{ data: IMAGE, amount: '1200', storeName: 'コンビニ' }], handoffText: '' }),
    );
    const result = await uploadReceipts(deps, tenantId, input());
    if (!result.ok) throw new Error('unreachable');
    expect(result).toMatchObject({ uploadedCount: 1, duplicateCount: 1 });
    expect(result.message).toBe('領収書を1件アップロードしました（重複1件は登録しませんでした）');
    const second = await receipts.findById(tenantId, 'receipt-2');
    expect(second?.handoffText).not.toBeNull();
  });

  it('お客様の指定なし(未登録のお客様)の領収書は、入力した氏名を保存し通知にも載せる', async () => {
    const result = await uploadReceipts(
      deps,
      tenantId,
      input({ customerId: null, customerNameText: ' 山田 様 ' }),
    );
    expect(result.ok).toBe(true);
    const row = await receipts.findById(tenantId, 'receipt-1');
    expect(row).toMatchObject({ customerId: null, customerNameText: '山田 様' });
    expect(notifier.notifications[0]?.text).toBe(
      '【領収書登録】\n担当: 佐藤 花子\n顧客名: 山田 様\n日付: 2026/08/30\n名称: コンビニ / 金額: 1200円\n名称: 駐車場 / 金額: 300円\n\n申し送り:\n鍵はポストへ',
    );
  });

  it('顧客を指定した場合は入力された氏名テキストを無視する', async () => {
    await uploadReceipts(deps, tenantId, input({ customerNameText: '別名' }));
    expect((await receipts.findById(tenantId, 'receipt-1'))?.customerNameText).toBeNull();
    expect(notifier.notifications[0]?.text).toContain('顧客名: 田中 一郎');
  });

  it('管理者以外が他スタッフを指定しても本人名義になる。管理者は他スタッフ名義で登録できる', async () => {
    await uploadReceipts(deps, tenantId, input({ requestedStaffId: otherStaffId }));
    expect((await receipts.findById(tenantId, 'receipt-1'))?.staffId).toBe(staffId);

    await uploadReceipts(
      deps,
      tenantId,
      input({ actor: { staffId, isAdmin: true }, requestedStaffId: otherStaffId, images: [{ data: IMAGE }] }),
    );
    expect((await receipts.findById(tenantId, 'receipt-3'))?.staffId).toBe(otherStaffId);
  });

  it('画像の種類は中身の先頭バイトで判定し、保存する種類・拡張子もそれに合わせる', async () => {
    const png = `data:image/jpeg;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
    const result = await uploadReceipts(deps, tenantId, input({ images: [{ data: png }] }));
    expect(result.ok).toBe(true);
    const saved = await receipts.findById(tenantId, 'receipt-1');
    expect(saved?.contentType).toBe('image/png');
    expect(saved?.fileKey).toMatch(/\.png$/);
  });

  it('画像以外のデータが1枚でもあれば何も保存しない', async () => {
    const html = `data:image/jpeg;base64,${Buffer.from('<html></html>').toString('base64')}`;
    const result = await uploadReceipts(deps, tenantId, input({ images: [{ data: IMAGE }, { data: html }] }));
    expect(result).toEqual({ ok: false, reason: 'invalid_image', index: 1, detail: 'unsupported_type' });
    expect(await receipts.findById(tenantId, 'receipt-1')).toBeNull();
  });

  it('7枚以上は受け付けない(GAS版と同じ6枚まで)', async () => {
    const images = Array.from({ length: 7 }, () => ({ data: IMAGE }));
    expect(await uploadReceipts(deps, tenantId, input({ images }))).toEqual({
      ok: false,
      reason: 'too_many_images',
    });
  });

  it('存在しない顧客IDはエラーにする', async () => {
    expect(await uploadReceipts(deps, tenantId, input({ customerId: 'no-such' }))).toEqual({
      ok: false,
      reason: 'customer_not_found',
    });
  });
});

describe('resolveReceiptFallbackTimestamp', () => {
  const now = new Date('2026-08-30T01:02:03Z'); // JST 10:02:03

  it('クライアント指定の日時を最優先する', () => {
    expect(
      resolveReceiptFallbackTimestamp(
        { receiptTimestamp: '2026/08/01 09:30:00', reportDate: '2026-08-02' },
        now,
      ),
    ).toBe('2026/08/01 09:30:00');
  });

  it('日報の訪問日+開始時刻から組み立てる(GAS版buildReceiptTimestampと同じ書式)', () => {
    expect(resolveReceiptFallbackTimestamp({ reportDate: '2026-08-02', startTime: '13:15' }, now)).toBe(
      '2026/08/02 13:15:00',
    );
  });

  it('何も無ければ現在時刻(JST)', () => {
    expect(resolveReceiptFallbackTimestamp({}, now)).toBe('2026/08/30 10:02:03');
  });
});
