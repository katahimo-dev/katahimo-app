import { newId, outboxDedupeKey } from '@katahimo/core/domain';
import type { VisitRow } from '@katahimo/core/ports';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { pgErrorOf } from '../errors';
import { DrizzleOutboxQueue } from '../repositories/platform/outboxQueue';
import { bytes, connect } from './testDb';

const { app, owner, worker, uow, createTenant, createStaff, createCustomer } = connect();

/** 失敗した問い合わせの SQLSTATE(drizzle は pg のエラーを cause に包む)。 */
const sqlState = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => pgErrorOf(error)?.code ?? String(error),
  );

const count = async (db: typeof app, query: ReturnType<typeof sql>) =>
  Number(((await db.execute(query)) as unknown as { n: string }[])[0]?.n ?? 0);

describe('テナントの分離(RLS)', () => {
  it('別テナントの行は見えず、テナントの設定が無ければ何も見えない', async () => {
    const [a, b] = [await createTenant(), await createTenant()];
    const customerId = await uow.run(a, (r) => createCustomer(r));
    expect(await uow.run(b, (r) => r.customers.findById(customerId))).toBeNull();
    expect(await uow.run(a, (r) => r.customers.findById(customerId))).not.toBeNull();
    expect(await count(app, sql`select count(*) as n from customers`)).toBe(0);
  });

  it('所有者にも RLS が掛かる(FORCE)。テナントを設定しなければ所有者でも読めない', async () => {
    const a = await createTenant();
    await uow.run(a, (r) => createCustomer(r));
    expect(await count(owner, sql`select count(*) as n from customers`)).toBe(0);
    expect(
      await withTenant(owner, a, (tx) => count(tx as never, sql`select count(*) as n from customers`)),
    ).toBe(1);
  });

  it('別テナントの tenant_id では書けない(WITH CHECK)', async () => {
    const [a, b] = [await createTenant(), await createTenant()];
    const insert = withTenant(app, a, (tx) =>
      tx.execute(
        sql`insert into customers (tenant_id, id, display_name, family_name, given_name) values (${b}, ${newId()}, 'x', 'x', '')`,
      ),
    );
    // 42501 insufficient_privilege(new row violates row-level security policy)
    expect(await sqlState(insert)).toBe('42501');
  });

  it('複合外部キー: 別テナントの顧客の ID を指す行は作れない', async () => {
    const [a, b] = [await createTenant(), await createTenant()];
    const otherCustomer = await uow.run(b, (r) => createCustomer(r));
    const insert = uow.run(a, (r) =>
      r.customerAddresses.insert({
        id: newId(),
        customerId: otherCustomer,
        kind: 'home',
        postalCode: null,
        prefecture: null,
        city: null,
        addressLine: '東京都',
        building: null,
        parkingArea: null,
        parkingDetail: null,
        geoEnc: null,
        geoCell: null,
        valid: { start: null, end: null },
        isPrimary: true,
      }),
    );
    // 23503 foreign_key_violation
    expect(await sqlState(insert)).toBe('23503');
  });
});

describe('Unit of Work', () => {
  it('work が例外を投げたら outbox の積み込みも含めて全てロールバックする', async () => {
    const a = await createTenant();
    const customerId = newId();
    await expect(
      uow.run(a, async (r) => {
        await r.customers.create({
          id: customerId,
          displayName: '佐藤 花子',
          familyName: '佐藤',
          givenName: '花子',
        });
        await r.outbox.enqueue({
          topic: 'mirror.care_record',
          aggregateType: 'care_record',
          aggregateId: customerId,
          dedupeKey: outboxDedupeKey('mirror.care_record', customerId, 1),
        });
        throw new Error('途中で失敗');
      }),
    ).rejects.toThrow('途中で失敗');
    expect(await uow.run(a, (r) => r.customers.findById(customerId))).toBeNull();
    expect(
      await withTenant(app, a, (tx) => count(tx as never, sql`select count(*) as n from outbox_messages`)),
    ).toBe(0);
  });

  it('同じ dedupe_key の再積み込みは何もしない', async () => {
    const a = await createTenant();
    const message = {
      topic: 'mirror.care_record' as const,
      aggregateType: 'care_record',
      aggregateId: newId(),
      dedupeKey: 'mirror.care_record:x:1',
    };
    await uow.run(a, async (r) => {
      await r.outbox.enqueue(message);
      await r.outbox.enqueue(message);
    });
    expect(
      await withTenant(app, a, (tx) => count(tx as never, sql`select count(*) as n from outbox_messages`)),
    ).toBe(1);
  });

  it('row_version が食い違う更新は 409 conflict', async () => {
    const a = await createTenant();
    const id = await uow.run(a, (r) => createCustomer(r));
    await uow.run(a, (r) => r.customers.update(id, { phone: '090' }, 1));
    await expect(uow.run(a, (r) => r.customers.update(id, { phone: '080' }, 1))).rejects.toMatchObject({
      code: 'conflict',
    });
  });
});

function visit(seq: number, start: string, end: string): VisitRow {
  return {
    id: newId(),
    seq,
    customerId: null,
    plannedPeriod: null,
    actualPeriod: { start: new Date(start), end: new Date(end) },
    status: 'completed',
    source: 'manual',
    externalEventId: null,
    labelEnc: bytes(`訪問${seq}`),
    overriddenFields: [],
  };
}

const emptyWrite = { insert: [], update: [], delete: [] };

describe('勤怠の制約・トリガー', () => {
  it('同じスタッフの訪問の時間帯が重なると 409 conflict(EXCLUDE、コミット時に判定)', async () => {
    const a = await createTenant();
    await expect(
      uow.run(a, async (r) => {
        const staffId = await createStaff(r);
        const day = await r.attendance.lockDay(staffId, '2026-09-24', newId());
        await r.attendance.writeDay(day.day.id, {
          day: { shoppingErrandCount: null, remarksEnc: null, overriddenFields: [] },
          visits: {
            insert: [
              visit(1, '2026-09-24T00:00:00Z', '2026-09-24T02:00:00Z'),
              visit(2, '2026-09-24T01:00:00Z', '2026-09-24T03:00:00Z'),
            ],
            update: [],
            delete: [],
          },
          segments: emptyWrite,
          legs: emptyWrite,
        });
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('締めた月の勤怠はトリガーが拒否する(locked)', async () => {
    const a = await createTenant();
    const { staffId, dayId } = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const day = await r.attendance.lockDay(staffId, '2026-09-24', newId());
      return { staffId, dayId: day.day.id };
    });
    await uow.run(a, (r) => r.attendance.lockPeriod(staffId, '2026-09', staffId, new Date()));
    await expect(
      uow.run(a, (r) =>
        r.attendance.writeDay(dayId, {
          day: { shoppingErrandCount: 1, remarksEnc: null, overriddenFields: [] },
          visits: emptyWrite,
          segments: emptyWrite,
          legs: emptyWrite,
        }),
      ),
    ).rejects.toMatchObject({ code: 'locked', reason: 'period_locked' });
  });
});

describe('活動記録', () => {
  it('本文を変えるとトリガーが変更前を履歴に残す(変更者は UoW の actorId)', async () => {
    const a = await createTenant();
    const { recordId, staffId } = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      const record = await r.careRecords.insert({
        id: newId(),
        recordType: 'daily_report',
        status: 'submitted',
        visitId: null,
        customerId,
        careRecipientId: null,
        authorStaffId: staffId,
        occurredAt: new Date(),
        servicePeriod: null,
        riskRating: null,
        esRating: null,
        bodyEnc: bytes('v1'),
        bodySchemaVer: 1,
        aiGenerated: false,
        retainUntil: null,
      });
      return { recordId: record.id, staffId };
    });
    await uow.run(a, (r) => r.careRecords.update(recordId, { bodyEnc: bytes('v2') }, 1), {
      actorId: staffId,
    });
    const revisions = (await withTenant(app, a, (tx) =>
      tx.execute(
        sql`select body_enc, changed_by from care_record_revisions where care_record_id = ${recordId}`,
      ),
    )) as unknown as { body_enc: Buffer; changed_by: string }[];
    expect(revisions.map((v) => [Buffer.from(v.body_enc).toString(), v.changed_by])).toEqual([
      ['v1', staffId],
    ]);
  });

  it('同じ記録日時が並んでもキーセットで重複・抜け無く読める', async () => {
    const a = await createTenant();
    const customerId = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      const at = new Date('2026-09-24T01:00:00Z');
      for (let i = 0; i < 12; i++) {
        await r.careRecords.insert({
          id: newId(),
          recordType: 'daily_report',
          status: 'submitted',
          visitId: null,
          customerId,
          careRecipientId: null,
          authorStaffId: staffId,
          occurredAt: i < 8 ? at : new Date(at.getTime() + i * 1000),
          servicePeriod: null,
          riskRating: null,
          esRating: null,
          bodyEnc: bytes(`r${i}`),
          bodySchemaVer: 1,
          aiGenerated: false,
          retainUntil: null,
        });
      }
      return customerId;
    });
    const seen: string[] = [];
    let after: { occurredAt: Date; id: string } | null = null;
    for (;;) {
      const page = await uow.run(a, (r) => r.careRecords.listByCustomer(customerId, after, 5));
      seen.push(...page.map((p) => p.id));
      const last = page.at(-1);
      if (page.length < 5 || !last) break;
      after = { occurredAt: last.occurredAt, id: last.id };
    }
    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
  });
});

describe('並行性', () => {
  it('同じ内容の領収書を同時に登録しても1件だけが残る(部分 UNIQUE + ON CONFLICT)', async () => {
    const a = await createTenant();
    const { staffId, uploadId } = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const uploadId = newId();
      await r.receipts.createUpload({
        id: uploadId,
        staffId,
        customerId: null,
        customerNameText: null,
        handoffTextEnc: null,
        createdBy: staffId,
      });
      return { staffId, uploadId };
    });
    const bidx = bytes('same-receipt');
    const attempt = () =>
      uow.run(a, async (r) => {
        const fileId = newId();
        await r.storedFiles.insert({
          id: fileId,
          storageKey: `${a}/receipts/${fileId}.jpg`,
          contentType: 'image/jpeg',
          byteSize: 1,
          sha256: new Uint8Array(32),
          purpose: 'receipt_image',
          createdBy: staffId,
        });
        return r.receipts.insertIfNew({
          id: newId(),
          uploadId,
          fileId,
          staffId,
          customerId: null,
          customerNameText: null,
          receiptedAt: new Date(),
          amountYen: 100,
          storeNameEnc: null,
          dedupeBidx: bidx,
        });
      });
    const results = await Promise.all(Array.from({ length: 6 }, attempt));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it.skipIf(!process.env.WORKER_DATABASE_URL)(
    'outbox: 複数のワーカーが同時に取り出しても1件を二重に処理しない',
    async () => {
      const a = await createTenant();
      const ids = await uow.run(a, async (r) => {
        const list: string[] = [];
        for (let i = 0; i < 20; i++) {
          const id = newId();
          list.push(id);
          await r.outbox.enqueue({
            topic: 'mirror.care_record',
            aggregateType: 'care_record',
            aggregateId: id,
            dedupeKey: `t:${id}`,
          });
        }
        return list;
      });
      const queue = new DrizzleOutboxQueue(worker as NonNullable<typeof worker>);
      const claimed: string[] = [];
      const run = async (workerId: string) => {
        for (;;) {
          const message = await queue.claimNext(workerId, 60_000, new Date());
          if (!message) return;
          if (message.tenantId === a) claimed.push(message.aggregateId);
          await queue.complete(message.id, message.tenantId, new Date());
        }
      };
      await Promise.all(['w1', 'w2', 'w3', 'w4'].map(run));
      expect(claimed.sort()).toEqual([...ids].sort());
    },
  );
});
