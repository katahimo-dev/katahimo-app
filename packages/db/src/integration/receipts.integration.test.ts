import { newId, receiptDedupeHash } from '@katahimo/core/domain';
import type { TenantRepositories } from '@katahimo/core/ports';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { pgErrorOf } from '../errors';
import { connect } from './testDb';

/**
 * 領収書の会社負担・取消(論理削除)を実際の DB で確かめる: 取消の列の CHECK、取消した行を除く部分 UNIQUE、
 * 行を消せない・取消の列しか変えられない権限、テナントの分離。
 */
const { app, uow, createTenant, createStaff } = connect();

const sqlState = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => pgErrorOf(error)?.code ?? String(error),
  );

/** スタッフ1人と登録の束を作る。 */
async function setup(tenantId: string) {
  return uow.run(tenantId, async (r) => {
    const staffId = await createStaff(r);
    const uploadId = newId();
    await r.receipts.createUpload({
      id: uploadId,
      staffId,
      customerId: null,
      customerNameText: null,
      handoffText: null,
      createdBy: staffId,
    });
    return { staffId, uploadId };
  });
}

/** 領収書を1枚登録する(重複なら false)。 */
async function insertReceipt(
  r: TenantRepositories,
  owner: { staffId: string; uploadId: string },
  options: { id?: string; dedupeKey?: string; amountYen?: number; companyPaid?: boolean; at?: Date } = {},
) {
  const fileId = newId();
  await r.storedFiles.insert({
    id: fileId,
    storageKey: `receipts/${fileId}.jpg`,
    contentType: 'image/jpeg',
    byteSize: 1,
    sha256: new Uint8Array(32),
    purpose: 'receipt_image',
    createdBy: owner.staffId,
  });
  return r.receipts.insertIfNew({
    id: options.id ?? newId(),
    uploadId: owner.uploadId,
    fileId,
    staffId: owner.staffId,
    customerId: null,
    customerNameText: null,
    receiptedAt: options.at ?? new Date('2026-09-10T03:00:00Z'),
    amountYen: options.amountYen ?? 100,
    storeName: '店',
    companyPaid: options.companyPaid ?? false,
    dedupeHash: options.dedupeKey ? receiptDedupeHash(options.dedupeKey) : null,
  });
}

const cancellation = (staffId: string, reason: string | null = null) => ({
  cancelledAt: new Date('2026-09-11T00:00:00Z'),
  cancelledBy: staffId,
  cancelReason: reason,
});

const SEPTEMBER = { from: new Date('2026-08-31T15:00:00Z'), to: new Date('2026-09-30T15:00:00Z') };

describe('領収書の取消(論理削除)', () => {
  it('取消すと行は残り、版が上がる。版が違う・取消済みは conflict', async () => {
    const tenant = await createTenant('rc');
    const owner = await setup(tenant);
    const id = newId();
    await uow.run(tenant, (r) => insertReceipt(r, owner, { id, companyPaid: true }));
    await expect(
      uow.run(tenant, (r) => r.receipts.cancel(id, cancellation(owner.staffId), 2)),
    ).rejects.toMatchObject({ code: 'conflict' });
    await uow.run(tenant, (r) => r.receipts.cancel(id, cancellation(owner.staffId, '間違い'), 1));
    const row = await uow.run(tenant, (r) => r.receipts.findListRow(id));
    expect(row).toMatchObject({
      companyPaid: true,
      cancelledBy: owner.staffId,
      cancelledByName: '山田 太郎',
      cancelReason: '間違い',
      rowVersion: 2,
    });
    await expect(
      uow.run(tenant, (r) => r.receipts.cancel(id, cancellation(owner.staffId), 2)),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('取消した行は合計・月の明細から除き、一覧は includeCancelled のときだけ出す', async () => {
    const tenant = await createTenant('rc');
    const owner = await setup(tenant);
    const cancelled = newId();
    await uow.run(tenant, async (r) => {
      await insertReceipt(r, owner, { amountYen: 1000 });
      await insertReceipt(r, owner, { amountYen: 600, companyPaid: true });
      await insertReceipt(r, owner, { id: cancelled, amountYen: 9999 });
      await r.receipts.cancel(cancelled, cancellation(owner.staffId), 1);
    });
    const result = await uow.run(tenant, async (r) => ({
      summary: await r.receipts.summarize({ ...SEPTEMBER, staffId: owner.staffId }),
      active: await r.receipts.listActiveByStaffAndPeriod(owner.staffId, SEPTEMBER.from, SEPTEMBER.to),
      all: await r.receipts.list({ ...SEPTEMBER, includeCancelled: true }, null, 10),
      activeList: await r.receipts.list({ ...SEPTEMBER, includeCancelled: false }, null, 10),
    }));
    expect(result.summary).toEqual({
      count: 2,
      totalYen: 1600,
      companyPaidYen: 600,
      noAmountCount: 0,
      cancelledCount: 1,
    });
    expect(result.active.map((r) => r.amountYen).sort()).toEqual([1000, 600]);
    expect(result.all).toHaveLength(3);
    expect(result.activeList.map((r) => r.id)).not.toContain(cancelled);
  });

  it('取消した領収書と同じ内容は登録し直せる(部分 UNIQUE は取消していない行だけ)', async () => {
    const tenant = await createTenant('rc');
    const owner = await setup(tenant);
    const first = newId();
    expect(await uow.run(tenant, (r) => insertReceipt(r, owner, { id: first, dedupeKey: 'same' }))).toBe(
      true,
    );
    expect(await uow.run(tenant, (r) => insertReceipt(r, owner, { dedupeKey: 'same' }))).toBe(false);
    await uow.run(tenant, (r) => r.receipts.cancel(first, cancellation(owner.staffId), 1));
    expect(await uow.run(tenant, (r) => insertReceipt(r, owner, { dedupeKey: 'same' }))).toBe(true);
    expect(await uow.run(tenant, (r) => insertReceipt(r, owner, { dedupeKey: 'same' }))).toBe(false);
  });

  it('CHECK: 取消の列は揃って入り、理由は1行・100文字まで', async () => {
    const tenant = await createTenant('rc');
    const owner = await setup(tenant);
    const id = newId();
    await uow.run(tenant, (r) => insertReceipt(r, owner, { id }));
    const update = (set: ReturnType<typeof sql>) =>
      withTenant(app, tenant, (tx) => tx.execute(sql`update receipts set ${set} where id = ${id}`));
    // 23514 check_violation
    expect(await sqlState(update(sql`cancel_reason = '理由だけ'`))).toBe('23514');
    expect(await sqlState(update(sql`cancelled_at = now()`))).toBe('23514');
    expect(await sqlState(update(sql`cancelled_by = ${owner.staffId}`))).toBe('23514');
    const cancel = (reason: string) =>
      update(sql`cancelled_at = now(), cancelled_by = ${owner.staffId}, cancel_reason = ${reason}`);
    expect(await sqlState(cancel('1行目\n2行目'))).toBe('23514');
    expect(await sqlState(cancel('あ'.repeat(101)))).toBe('23514');
    expect(await sqlState(cancel('あ'.repeat(100)))).toBeNull();
  });

  it('アプリのロールは領収書を消せず、取消の列と版の他は変えられない', async () => {
    const tenant = await createTenant('rc');
    const owner = await setup(tenant);
    const id = newId();
    await uow.run(tenant, (r) => insertReceipt(r, owner, { id }));
    const exec = (query: ReturnType<typeof sql>) => withTenant(app, tenant, (tx) => tx.execute(query));
    // 42501 insufficient_privilege
    expect(await sqlState(exec(sql`delete from receipts where id = ${id}`))).toBe('42501');
    expect(await sqlState(exec(sql`delete from receipt_uploads where id = ${owner.uploadId}`))).toBe('42501');
    expect(await sqlState(exec(sql`update receipts set amount_yen = 1 where id = ${id}`))).toBe('42501');
    expect(await sqlState(exec(sql`update receipts set company_paid = true where id = ${id}`))).toBe('42501');
    expect(
      await sqlState(exec(sql`update receipt_uploads set handoff_text = 'x' where id = ${owner.uploadId}`)),
    ).toBe('42501');
  });

  it('別のテナントの領収書は取消せない(RLS で見えないため conflict)', async () => {
    const [a, b] = [await createTenant('rc'), await createTenant('rc')];
    const owner = await setup(a);
    const other = await setup(b);
    const id = newId();
    await uow.run(a, (r) => insertReceipt(r, owner, { id }));
    await expect(
      uow.run(b, (r) => r.receipts.cancel(id, cancellation(other.staffId), 1)),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(await uow.run(b, (r) => r.receipts.findListRow(id))).toBeNull();
    expect((await uow.run(a, (r) => r.receipts.findById(id)))?.cancelledAt).toBeNull();
  });

  it('締め済みの出勤簿のスタッフを月ごとに返す', async () => {
    const tenant = await createTenant('rc');
    const owner = await setup(tenant);
    await uow.run(tenant, (r) =>
      r.attendance.lockPeriod(owner.staffId, '2026-08', owner.staffId, new Date()),
    );
    expect(await uow.run(tenant, (r) => r.attendance.listLockedStaffIds('2026-08'))).toEqual([owner.staffId]);
    expect(await uow.run(tenant, (r) => r.attendance.listLockedStaffIds('2026-09'))).toEqual([]);
  });
});
