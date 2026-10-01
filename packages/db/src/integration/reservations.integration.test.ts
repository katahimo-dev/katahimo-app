import { DomainError, newId } from '@katahimo/core/domain';
import type { TenantRepositories } from '@katahimo/core/ports';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { DrizzleUnitOfWork } from '../uow';
import { connect } from './testDb';

/**
 * 予約とスタッフの割当(reservations + reservation_assignments)を実際の DB で確かめる。
 * SCHEDULE_PROVIDER=database の予定の取得(DatabaseSchedulePort)が使う(予約の登録は今後のマッチングのアプリが使う)。
 */
const { app, owner, worker, uow, createTenant, createStaff, createCustomer } = connect();
const DATE = '2026-09-29';
const at = (time: string, date = DATE) => new Date(`${date}T${time}:00+09:00`);

function reserve(
  r: TenantRepositories,
  input: { customerId: string; staffId: string; from: string; to: string; date?: string },
): Promise<string> {
  const id = newId();
  const date = input.date ?? DATE;
  return r.reservations
    .create({
      id,
      customerId: input.customerId,
      period: { start: at(input.from, date), end: at(input.to, date) },
      businessDate: date,
      status: 'confirmed',
      assignments: [{ id: newId(), staffId: input.staffId, confirmedAt: new Date() }],
    })
    .then(() => id);
}

async function setup() {
  const tenantId = await createTenant('reservation');
  const ids = await uow.run(tenantId, async (r) => {
    const staffId = await createStaff(r, '山田 太郎');
    const otherStaffId = await createStaff(r, '佐藤 次郎');
    const customerId = await createCustomer(r, '鈴木 花子');
    const otherCustomerId = await createCustomer(r, '田中 一郎');
    return { staffId, otherStaffId, customerId, otherCustomerId };
  });
  return { tenantId, ...ids };
}

describe('予約とスタッフの割当(reservations)', () => {
  it('スタッフのその日の確定した訪問を開始時刻順に返す(取消・辞退・他のスタッフ・他の日は含めない)', async () => {
    const { tenantId, staffId, otherStaffId, customerId, otherCustomerId } = await setup();
    const ids = await uow.run(tenantId, async (r) => ({
      afternoon: await reserve(r, { customerId: otherCustomerId, staffId, from: '13:00', to: '14:30' }),
      morning: await reserve(r, { customerId, staffId, from: '10:00', to: '11:30' }),
      cancelled: await reserve(r, { customerId, staffId, from: '16:00', to: '17:00' }),
      declined: await reserve(r, { customerId, staffId, from: '18:00', to: '19:00' }),
      other: await reserve(r, { customerId, staffId: otherStaffId, from: '10:00', to: '11:30' }),
      tomorrow: await reserve(r, { customerId, staffId, from: '10:00', to: '11:30', date: '2026-09-30' }),
    }));
    await withTenant(app, tenantId, async (tx) => {
      await tx.execute(sql`update reservations set status = 'cancelled' where id = ${ids.cancelled}::uuid`);
      await tx.execute(
        sql`update reservation_assignments set status = 'declined', declined_at = now()
            where reservation_id = ${ids.declined}::uuid`,
      );
    });

    const visits = await uow.run(tenantId, (r) =>
      r.reservations.listConfirmedVisitsForStaffOnDate(staffId, DATE),
    );
    expect(visits).toEqual([
      {
        reservationId: ids.morning,
        customerId,
        customerDisplayName: '鈴木 花子',
        start: at('10:00'),
        end: at('11:30'),
      },
      {
        reservationId: ids.afternoon,
        customerId: otherCustomerId,
        customerDisplayName: '田中 一郎',
        start: at('13:00'),
        end: at('14:30'),
      },
    ]);

    // ワーカー(夜間の反映・翌日のお知らせ)も読める
    if (worker) {
      const fromWorker = await new DrizzleUnitOfWork(worker).run(tenantId, (r) =>
        r.reservations.listConfirmedVisitsForStaffOnDate(staffId, DATE),
      );
      expect(fromWorker.map((v) => v.reservationId)).toEqual([ids.morning, ids.afternoon]);
    }
  });

  it('同じスタッフの確定した割当の時間帯は重ねられない(EXCLUDE → conflict)', async () => {
    const { tenantId, staffId, customerId, otherCustomerId } = await setup();
    await uow.run(tenantId, (r) => reserve(r, { customerId, staffId, from: '10:00', to: '11:30' }));
    const overlapping = uow.run(tenantId, (r) =>
      reserve(r, { customerId: otherCustomerId, staffId, from: '11:00', to: '12:00' }),
    );
    await expect(overlapping).rejects.toBeInstanceOf(DomainError);
    await expect(overlapping).rejects.toMatchObject({ code: 'conflict' });
    // 半開区間なので、終わりの時刻から始まる予約は重ならない
    await uow.run(tenantId, (r) =>
      reserve(r, { customerId: otherCustomerId, staffId, from: '11:30', to: '12:00' }),
    );
  });

  it('別テナントの予約は見えず、テナントを設定しなければ所有者でも読めない(FORCE RLS)', async () => {
    const a = await setup();
    const b = await setup();
    await uow.run(a.tenantId, (r) =>
      reserve(r, { customerId: a.customerId, staffId: a.staffId, from: '10:00', to: '11:00' }),
    );
    // B のテナントから A のスタッフ ID で問い合わせても出ない
    expect(
      await uow.run(b.tenantId, (r) => r.reservations.listConfirmedVisitsForStaffOnDate(a.staffId, DATE)),
    ).toEqual([]);
    const rows = (await owner.execute(sql`select count(*) as n from reservations`)) as unknown as {
      n: string;
    }[];
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });
});
