import { newId, outboxDedupeKey, receiptDedupeHash } from '@katahimo/core/domain';
import type { TenantRepositories, VisitRow } from '@katahimo/core/ports';
import { applyCustomerSnapshot, withOutboxDrainTrigger } from '@katahimo/core/usecases';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { pgErrorOf } from '../errors';
import { DrizzleOutboxQueue } from '../repositories/platform/outboxQueue';
import { DrizzleRateLimiter } from '../repositories/platform/rateLimiter';
import { connect, reportBody } from './testDb';

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
        geo: null,
        latLngText: null,
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

  it('outbox-drain の起動の依頼は、積んだトランザクションのコミットの後にだけ行う(重複・ロールバックでは行わない)', async () => {
    const a = await createTenant();
    const notified: number[] = [];
    const outboxCount = () =>
      withTenant(app, a, (tx) => count(tx as never, sql`select count(*) as n from outbox_messages`));
    const triggering = withOutboxDrainTrigger(uow, {
      // 依頼の時点でコミット済み(別の接続から見える)であること
      notify: async () => void notified.push(await outboxCount()),
    });
    const message = {
      topic: 'mirror.care_record' as const,
      aggregateType: 'care_record',
      aggregateId: newId(),
      dedupeKey: `mirror.care_record:${newId()}:1`,
    };
    await triggering.run(a, (r) => r.outbox.enqueue(message));
    await triggering.run(a, (r) => r.outbox.enqueue(message));
    await expect(
      triggering.run(a, async (r) => {
        await r.outbox.enqueue({ ...message, dedupeKey: `mirror.care_record:${newId()}:2` });
        throw new Error('途中で失敗');
      }),
    ).rejects.toThrow('途中で失敗');
    expect(notified).toEqual([1]);
    expect(await outboxCount()).toBe(1);
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

async function insertRecord(
  r: TenantRepositories,
  staffId: string,
  customerId: string,
  status: 'draft' | 'submitted' | 'locked',
): Promise<string> {
  const record = await r.careRecords.insert({
    id: newId(),
    recordType: 'daily_report',
    status,
    visitId: null,
    customerId,
    careRecipientId: null,
    authorStaffId: staffId,
    occurredAt: new Date(),
    servicePeriod: null,
    riskRating: null,
    esRating: null,
    body: reportBody('v1'),
    bodySchemaVer: 1,
    retainUntil: null,
  });
  return record.id;
}

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
    label: `訪問${seq}`,
    overriddenFields: [],
  };
}

const emptyWrite = { insert: [], update: [], delete: [] };

describe('勤怠の制約・トリガー', () => {
  it('同じスタッフの訪問の時間帯が重なっても保存できる(予定の正はカレンダー。GAS版と同じ)', async () => {
    const a = await createTenant();
    const saved = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const day = await r.attendance.lockDay(staffId, '2026-09-24', newId());
      await r.attendance.writeDay(day.day.id, {
        day: { shoppingErrandCount: null, remarks: null, overriddenFields: [] },
        visits: {
          insert: [
            visit(1, '2026-09-24T00:00:00Z', '2026-09-24T03:00:00Z'),
            visit(2, '2026-09-24T02:30:00Z', '2026-09-24T04:00:00Z'),
          ],
          update: [],
          delete: [],
        },
        segments: emptyWrite,
        legs: emptyWrite,
      });
      return r.attendance.loadDay(staffId, '2026-09-24');
    });
    expect(saved.visits).toHaveLength(2);
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
          day: { shoppingErrandCount: 1, remarks: null, overriddenFields: [] },
          visits: emptyWrite,
          segments: emptyWrite,
          legs: emptyWrite,
        }),
      ),
    ).rejects.toMatchObject({ code: 'locked', reason: 'period_locked' });
  });
});

describe('顧客の取込(applyCustomerSnapshot)', () => {
  it('住所2の適用終了日が開始日の前日・それより前でも DB の制約で失敗せず、期間なしで持つ', async () => {
    const a = await createTenant();
    const snapshot = (externalId: string, validFrom: string, validTo: string) => ({
      source: 'reserva' as const,
      externalId,
      displayName: '佐藤 花子',
      familyName: '佐藤',
      givenName: '花子',
      attributes: {},
      home: null,
      secondary: { addressLine: '神奈川県横浜市1-1', validFrom, validTo },
      emergencyContact: null,
      recipients: [],
    });
    const outcomes = await uow.run(a, async (r) => [
      await applyCustomerSnapshot(
        { runId: null },
        r,
        snapshot('R-1', '2026-10-01', '2026-09-30'),
        new Date(),
      ),
      await applyCustomerSnapshot(
        { runId: null },
        r,
        snapshot('R-2', '2026-10-05', '2026-09-01'),
        new Date(),
      ),
    ]);
    expect(outcomes).toEqual(['created', 'created']);
    const ranges = (await withTenant(app, a, (tx) =>
      tx.execute(sql`select valid::text as valid from customer_addresses where kind = 'secondary'`),
    )) as unknown as { valid: string }[];
    expect(ranges.map((v) => v.valid)).toEqual(['(,)', '(,)']);
  });
});

describe('月の締め(attendance_periods)', () => {
  const day = (r: TenantRepositories, staffId: string) =>
    r.attendance.lockDay(staffId, '2026-09-24', newId());
  const insertVisit = (r: TenantRepositories, dayId: string, seq: number) =>
    r.attendance.writeDay(dayId, {
      day: { shoppingErrandCount: null, remarks: null, overriddenFields: [] },
      visits: {
        insert: [visit(seq, '2026-09-24T00:00:00Z', '2026-09-24T01:00:00Z')],
        update: [],
        delete: [],
      },
      segments: emptyWrite,
      legs: emptyWrite,
    });

  it('アプリは締めを解除・削除できない(解除は所有者の platform.unlock_attendance_period だけ)', async () => {
    const a = await createTenant();
    const staffId = await uow.run(a, (r) => createStaff(r));
    await uow.run(a, (r) => r.attendance.lockPeriod(staffId, '2026-09', staffId, new Date()));
    // 締め済みを締め直しても何も変えない
    await uow.run(a, (r) => r.attendance.lockPeriod(staffId, '2026-09', staffId, new Date()));
    const unlock = withTenant(app, a, (tx) =>
      tx.execute(
        sql`update attendance_periods set status = 'open', locked_at = null where staff_id = ${staffId}`,
      ),
    );
    expect(await sqlState(unlock)).toBe('KH001');
    const remove = withTenant(app, a, (tx) =>
      tx.execute(sql`delete from attendance_periods where staff_id = ${staffId}`),
    );
    expect(await sqlState(remove)).toBe('42501');
    const appCall = app.execute(
      sql`select platform.unlock_attendance_period(${a}::uuid, ${staffId}::uuid, '2026-09')`,
    );
    expect(await sqlState(appCall)).toBe('42501');
    const [row] = (await owner.execute(
      sql`select platform.unlock_attendance_period(${a}::uuid, ${staffId}::uuid, '2026-09') as unlocked`,
    )) as unknown as { unlocked: boolean }[];
    expect(row?.unlocked).toBe(true);
    await uow.run(a, async (r) => insertVisit(r, (await day(r, staffId)).day.id, 1));
  });

  it('アプリは締めた行を別の月・別のスタッフに付け替えられず、締めの日時・締めた人も書き換えられない', async () => {
    const a = await createTenant();
    const { staffId, otherId } = await uow.run(a, async (r) => ({
      staffId: await createStaff(r),
      otherId: await createStaff(r),
    }));
    await uow.run(a, (r) => r.attendance.lockPeriod(staffId, '2026-09', staffId, new Date()));
    // 付け替え(締めたまま月・スタッフを変える)は列の権限で断る(42501)
    const rekeys = [
      sql`update attendance_periods set year_month = '2026-08' where staff_id = ${staffId}`,
      sql`update attendance_periods set staff_id = ${otherId} where staff_id = ${staffId}`,
      sql`update attendance_periods set created_at = now() where staff_id = ${staffId}`,
    ];
    for (const statement of rekeys) {
      expect(await sqlState(withTenant(app, a, (tx) => tx.execute(statement)))).toBe('42501');
    }
    // 書ける列(締めの列)でも、締めた行の締めの日時・締めた人の書き換えはトリガーが断る(KH001)
    const rewrites = [
      sql`update attendance_periods set locked_at = now() - interval '1 day' where staff_id = ${staffId}`,
      sql`update attendance_periods set locked_by = ${otherId} where staff_id = ${staffId}`,
    ];
    for (const statement of rewrites) {
      expect(await sqlState(withTenant(app, a, (tx) => tx.execute(statement)))).toBe('KH001');
    }
    const rows = (await withTenant(app, a, (tx) =>
      tx.execute(sql`select staff_id, year_month, status, locked_by from attendance_periods`),
    )) as unknown as { staff_id: string; year_month: string; status: string; locked_by: string }[];
    expect(rows).toEqual([
      { staff_id: staffId, year_month: '2026-09', status: 'locked', locked_by: staffId },
    ]);
    // 締めた月の勤怠は書けないまま
    await expect(
      uow.run(a, async (r) => insertVisit(r, (await day(r, staffId)).day.id, 1)),
    ).rejects.toMatchObject({ code: 'locked', reason: 'period_locked' });
    // 所有者(運用)は付け替えられる(トリガーの例外は所有者だけ)
    await withTenant(owner, a, (tx) =>
      tx.execute(sql`update attendance_periods set year_month = '2026-08' where staff_id = ${staffId}`),
    );
    await uow.run(a, async (r) => insertVisit(r, (await day(r, staffId)).day.id, 1));
  });

  it('締めは、同じ月の勤怠を書いているトランザクションの終わりを待つ(書き込みと締めが食い違わない)', async () => {
    const a = await createTenant();
    const staffId = await uow.run(a, (r) => createStaff(r));
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written = () => {};
    const wrote = new Promise<void>((resolve) => {
      written = resolve;
    });
    const writer = uow.run(a, async (r) => {
      await insertVisit(r, (await day(r, staffId)).day.id, 1);
      written();
      await gate;
    });
    await wrote;
    let lockedAt: number | null = null;
    const locker = uow
      .run(a, (r) => r.attendance.lockPeriod(staffId, '2026-09', staffId, new Date()))
      .then(() => {
        lockedAt = Date.now();
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lockedAt).toBeNull();
    const committedAt = Date.now();
    release();
    await writer;
    await locker;
    expect(lockedAt).not.toBeNull();
    expect(lockedAt as unknown as number).toBeGreaterThanOrEqual(committedAt);
    // 締めた後の書き込みは拒否
    await expect(
      uow.run(a, async (r) => insertVisit(r, (await day(r, staffId)).day.id, 2)),
    ).rejects.toMatchObject({ code: 'locked', reason: 'period_locked' });
    const visits = await uow.run(a, (r) => r.attendance.loadDay(staffId, '2026-09-24'));
    expect(visits.visits).toHaveLength(1);
  });

  it('isPeriodLocked は締めた月だけ true を返し、締めと同じキーの共有ロックをトランザクションの終わりまで持つ(アプリのロール)', async () => {
    const a = await createTenant();
    const { staffId, otherId } = await uow.run(a, async (r) => ({
      staffId: await createStaff(r),
      otherId: await createStaff(r),
    }));
    await uow.run(a, (r) => r.attendance.lockPeriod(staffId, '2026-08', staffId, new Date()));
    expect(
      await uow.run(a, async (r) => [
        await r.attendance.isPeriodLocked(staffId, '2026-08'),
        await r.attendance.isPeriodLocked(staffId, '2026-09'),
        await r.attendance.isPeriodLocked(otherId, '2026-08'),
      ]),
    ).toEqual([true, false, false]);
    // 別のテナントからは締めが見えない(テナントは UoW の設定から読む)
    const b = await createTenant();
    expect(await uow.run(b, (r) => r.attendance.isPeriodLocked(staffId, '2026-08'))).toBe(false);

    // 別の接続から同じキーの排他ロックを試す(取れれば文の終わりで放す)
    const tryExclusive = async () =>
      (
        (await owner.execute(
          sql`select pg_try_advisory_xact_lock(public.attendance_period_lock_key(${a}::uuid, ${staffId}::uuid, '2026-09')) as ok`,
        )) as unknown as { ok: boolean }[]
      )[0]?.ok;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let checked = () => {};
    const wasChecked = new Promise<void>((resolve) => {
      checked = resolve;
    });
    const reader = uow.run(a, async (r) => {
      const locked = await r.attendance.isPeriodLocked(staffId, '2026-09');
      checked();
      await gate;
      return locked;
    });
    await wasChecked;
    expect(await tryExclusive()).toBe(false);
    // 締めは、確かめたトランザクションの終わりを待つ
    let lockedAt: number | null = null;
    const locker = uow
      .run(a, (r) => r.attendance.lockPeriod(staffId, '2026-09', staffId, new Date()))
      .then(() => {
        lockedAt = Date.now();
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(lockedAt).toBeNull();
    const committedAt = Date.now();
    release();
    expect(await reader).toBe(false);
    await locker;
    expect(lockedAt as unknown as number).toBeGreaterThanOrEqual(committedAt);
    expect(await tryExclusive()).toBe(true);
    expect(await uow.run(a, (r) => r.attendance.isPeriodLocked(staffId, '2026-09'))).toBe(true);
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
        body: reportBody('v1'),
        bodySchemaVer: 1,
        retainUntil: null,
      });
      return { recordId: record.id, staffId };
    });
    await uow.run(a, (r) => r.careRecords.update(recordId, { body: reportBody('v2') }, 1), {
      actorId: staffId,
    });
    const revisions = (await withTenant(app, a, (tx) =>
      tx.execute(sql`select body, changed_by from care_record_revisions where care_record_id = ${recordId}`),
    )) as unknown as { body: { inputText: string }; changed_by: string }[];
    expect(revisions.map((v) => [v.body.inputText, v.changed_by])).toEqual([['v1', staffId]]);
  });

  it('確定済み(locked)の記録は本文以外も含めて変更・削除できず、locked から戻せない(KH002)', async () => {
    const a = await createTenant();
    const recordId = await uow.run(a, async (r) =>
      insertRecord(r, await createStaff(r), await createCustomer(r), 'locked'),
    );
    const attempts = [
      sql`update care_records set risk_rating = 2 where id = ${recordId}`,
      sql`update care_records set status = 'submitted' where id = ${recordId}`,
      sql`delete from care_records where id = ${recordId}`,
    ];
    for (const statement of attempts) {
      expect(await sqlState(withTenant(app, a, (tx) => tx.execute(statement)))).toBe('KH002');
    }
    await expect(uow.run(a, (r) => r.careRecords.update(recordId, { riskRating: 3 }))).rejects.toMatchObject({
      code: 'locked',
      reason: 'record_locked',
    });
  });

  it('下書き以外は本文(中身・形式の版)が変わるたびに履歴を残し、下書きの変更・状態だけの変更は残さない', async () => {
    const a = await createTenant();
    const { submitted, draft } = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      return {
        submitted: await insertRecord(r, staffId, customerId, 'submitted'),
        draft: await insertRecord(r, staffId, customerId, 'draft'),
      };
    });
    await uow.run(a, (r) => r.careRecords.update(submitted, { bodySchemaVer: 2 }));
    await uow.run(a, (r) => r.careRecords.update(submitted, { riskRating: 2 }));
    await uow.run(a, (r) => r.careRecords.update(submitted, { body: reportBody('v2') }));
    await uow.run(a, (r) => r.careRecords.update(draft, { body: reportBody('d2') }));
    const revisions = (await withTenant(app, a, (tx) =>
      tx.execute(
        sql`select care_record_id, revision_no, body_schema_ver from care_record_revisions order by care_record_id, revision_no`,
      ),
    )) as unknown as { care_record_id: string; revision_no: number; body_schema_ver: number }[];
    expect(revisions.map((v) => [v.care_record_id, v.revision_no, v.body_schema_ver])).toEqual([
      [submitted, 1, 1],
      [submitted, 2, 2],
    ]);
    // 履歴のある記録は消せない(履歴が記録と一緒に消えない)
    const remove = withTenant(app, a, (tx) =>
      tx.execute(sql`delete from care_records where id = ${submitted}`),
    );
    expect(await sqlState(remove)).toBe('23503');
  });

  it('本文の履歴はトリガーだけが書き(アプリは直接書けない)、提出した記録は下書きに戻せない(KH004)', async () => {
    const a = await createTenant();
    const { recordId, staffId } = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      return { staffId, recordId: await insertRecord(r, staffId, await createCustomer(r), 'submitted') };
    });
    const forged = withTenant(app, a, (tx) =>
      tx.execute(
        sql`insert into care_record_revisions (tenant_id, id, care_record_id, revision_no, body, body_schema_ver)
            values (${a}, ${newId()}, ${recordId}, 99, '{}'::jsonb, 1)`,
      ),
    );
    expect(await sqlState(forged)).toBe('42501');
    expect(
      await sqlState(
        withTenant(app, a, (tx) =>
          tx.execute(sql`update care_records set status = 'draft' where id = ${recordId}`),
        ),
      ),
    ).toBe('KH004');
    await expect(
      uow.run(a, (r) => r.careRecords.update(recordId, { status: 'draft' })),
    ).rejects.toMatchObject({
      code: 'conflict',
      reason: 'record_not_draft',
    });
    // トリガー(所有者の権限)は今までどおり履歴を書き、変更者はセッションの app.actor_id
    await uow.run(a, (r) => r.careRecords.update(recordId, { body: reportBody('v2') }), { actorId: staffId });
    const revisions = (await withTenant(app, a, (tx) =>
      tx.execute(
        sql`select revision_no, changed_by from care_record_revisions where care_record_id = ${recordId}`,
      ),
    )) as unknown as { revision_no: number; changed_by: string }[];
    expect(revisions.map((v) => [v.revision_no, v.changed_by])).toEqual([[1, staffId]]);
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
          body: reportBody(`r${i}`),
          bodySchemaVer: 1,
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
        handoffText: null,
        createdBy: staffId,
      });
      return { staffId, uploadId };
    });
    const dedupeHash = receiptDedupeHash('same-receipt');
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
          storeName: null,
          companyPaid: false,
          dedupeHash,
          dedupePrimary: true,
        });
      });
    const results = await Promise.all(Array.from({ length: 6 }, attempt));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('レート制限: 同時の consume でも上限の回数だけを許可し、refund で1回分を返す(上限を下回ればロックも解く)', async () => {
    const limiter = new DrizzleRateLimiter(app, 'rate-limit-test-secret');
    const rule = { name: 'it_login', limit: 4, windowMs: 60_000, lockMs: 60_000 };
    const key = `ip-${newId()}`;
    const now = new Date();
    const decisions = await Promise.all(Array.from({ length: 12 }, () => limiter.consume(rule, key, now)));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(4);
    const other = `ip-${newId()}`;
    for (let i = 0; i < 4; i++) await limiter.consume(rule, other, now);
    expect((await limiter.consume(rule, other, now)).allowed).toBe(false);
    const fresh = `ip-${newId()}`;
    for (let i = 0; i < 3; i++) await limiter.consume(rule, fresh, now);
    // 4回目(ロックが始まる回)が成功だった → 返せばロックも解ける
    expect(await limiter.consume(rule, fresh, now)).toMatchObject({ allowed: true, lockStarted: true });
    await limiter.refund(rule, fresh);
    expect((await limiter.consume(rule, fresh, now)).allowed).toBe(true);
  });

  it('同じ AI プロンプトを同時に保存しても、版が重ならず全て保存できる', async () => {
    const a = await createTenant();
    const staffId = await uow.run(a, (r) => createStaff(r));
    const key = 'daily_report_prompt';
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        uow.run(a, async (r) => {
          await r.aiPrompts.save({ key, kind: 'prompt', body: `本文${i}`, updatedBy: staffId });
          if (i % 3 === 0) await r.aiPrompts.reset(key, staffId);
        }),
      ),
    );
    const revisions = (await withTenant(app, a, (tx) =>
      tx.execute(sql`select revision from ai_prompt_revisions where key = ${key} order by revision`),
    )) as unknown as { revision: number }[];
    expect(revisions.map((v) => v.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
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
          await queue.complete(message, new Date());
        }
      };
      await Promise.all(['w1', 'w2', 'w3', 'w4'].map(run));
      expect(claimed.sort()).toEqual([...ids].sort());
    },
  );

  it.skipIf(!process.env.WORKER_DATABASE_URL)(
    'outbox: リースが切れて取り直された後、古い処理の結果は書かない。上限に達した切れたリースは dead',
    async () => {
      const a = await createTenant();
      const aggregateId = newId();
      await uow.run(a, (r) =>
        r.outbox.enqueue({
          topic: 'mirror.care_record',
          aggregateType: 'care_record',
          aggregateId,
          dedupeKey: `lease:${aggregateId}`,
        }),
      );
      const queue = new DrizzleOutboxQueue(worker as NonNullable<typeof worker>);
      // 他のテストの残りを取らないよう、このテナントのメッセージだけを対象にする(取れるまで進める)
      const claimOwn = async (workerId: string, leaseMs: number, now: Date) => {
        for (;;) {
          const m = await queue.claimNext(workerId, leaseMs, now);
          if (!m || m.tenantId === a) return m;
          await queue.complete(m, now);
        }
      };
      const t0 = new Date();
      const first = await claimOwn('w1', 1_000, t0);
      expect(first).toMatchObject({ aggregateId, attempts: 1, lockedBy: 'w1' });
      const second = await claimOwn('w2', 60_000, new Date(t0.getTime() + 2_000));
      expect(second).toMatchObject({ aggregateId, attempts: 2, lockedBy: 'w2' });
      // w1 の処理が遅れて終わっても、w2 のリースを上書きしない
      expect(await queue.retry(first as NonNullable<typeof first>, '遅れた失敗', new Date())).toBe(false);
      expect(await queue.complete(first as NonNullable<typeof first>, new Date())).toBe(false);
      expect(await queue.complete(second as NonNullable<typeof second>, new Date())).toBe(true);
      const status = async (key: string) =>
        (
          (await withTenant(app, a, (tx) =>
            tx.execute(sql`select status from outbox_messages where dedupe_key = ${key}`),
          )) as unknown as { status: string }[]
        )[0]?.status;
      expect(await status(`lease:${aggregateId}`)).toBe('done');

      // 上限(max_attempts = 1)に達したまま切れたリースは取り直さず dead にする
      const exhaustedId = newId();
      await uow.run(a, (r) =>
        r.outbox.enqueue({
          topic: 'mirror.care_record',
          aggregateType: 'care_record',
          aggregateId: exhaustedId,
          dedupeKey: `exhausted:${exhaustedId}`,
        }),
      );
      await (worker as NonNullable<typeof worker>).execute(
        sql`update outbox_messages set max_attempts = 1 where dedupe_key = ${`exhausted:${exhaustedId}`}`,
      );
      const t1 = new Date();
      expect(await claimOwn('w1', 1_000, t1)).toMatchObject({ aggregateId: exhaustedId, attempts: 1 });
      const later = new Date(t1.getTime() + 2_000);
      const expired = await queue.expireExhaustedLeases(later, 'リース切れ');
      expect(expired.map((e) => e.aggregateId)).toContain(exhaustedId);
      expect(await claimOwn('w2', 60_000, later)).toBeNull();
      expect(await status(`exhausted:${exhaustedId}`)).toBe('dead');
    },
  );
});

describe('テナントの消去(platform.purge_tenant)', () => {
  it('締めた月の勤怠・確定済みの記録・記録の履歴があっても、解約済みのテナントを全て消せる', async () => {
    const a = await createTenant();
    const staffId = await uow.run(a, async (r) => {
      const staffId = await createStaff(r);
      const customerId = await createCustomer(r);
      const day = await r.attendance.lockDay(staffId, '2026-09-24', newId());
      await r.attendance.writeDay(day.day.id, {
        day: { shoppingErrandCount: 1, remarks: null, overriddenFields: [] },
        visits: {
          insert: [visit(1, '2026-09-24T00:00:00Z', '2026-09-24T01:00:00Z')],
          update: [],
          delete: [],
        },
        segments: emptyWrite,
        legs: emptyWrite,
      });
      const submitted = await insertRecord(r, staffId, customerId, 'submitted');
      await r.careRecords.update(submitted, { body: reportBody('v2') });
      await r.careRecords.update(submitted, { status: 'locked' });
      return staffId;
    });
    await uow.run(a, (r) => r.attendance.lockPeriod(staffId, '2026-09', staffId, new Date()));

    const purge = () =>
      owner.execute(sql`select platform.purge_tenant(${a}::uuid) as purged`) as unknown as Promise<
        { purged: boolean }[]
      >;
    // 解約済みでなければ消さない。アプリからは実行できない
    expect(await sqlState(purge())).toBe('P0001');
    expect(await sqlState(app.execute(sql`select platform.purge_tenant(${a}::uuid)`))).toBe('42501');

    await owner.execute(
      sql`update platform.tenants set status = 'terminated', terminated_at = now() where id = ${a}`,
    );
    expect((await purge())[0]?.purged).toBe(true);
    const remaining = await withTenant(owner, a, (tx) =>
      count(
        tx as never,
        sql`select (select count(*) from staff) + (select count(*) from attendance_periods)
                 + (select count(*) from attendance_days) + (select count(*) from visits)
                 + (select count(*) from care_records) + (select count(*) from care_record_revisions)
                 + (select count(*) from tenant_settings) as n`,
      ),
    );
    expect(remaining).toBe(0);
    expect((await purge())[0]?.purged).toBe(false);
  });
});
