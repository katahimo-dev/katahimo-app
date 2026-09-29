import { estimateRouteLeg } from '@katahimo/core/domain';
import { createTestContext } from '@katahimo/core/test-utils';
import { applyCustomerSnapshot, createScheduleDirectory } from '@katahimo/core/usecases';
import { describe, expect, it } from 'vitest';
import { DatabaseSchedulePort } from './databaseSchedulePort';

const DATE = '2026-09-25';
const jst = (time: string, date = DATE) => new Date(`${date}T${time}:00+09:00`);
const HOME = { lat: 34.7, lng: 135.5 };
const YAMADA = { lat: 34.6863, lng: 135.5259 };
const SUZUKI = { lat: 34.6925, lng: 135.5075 };

async function setup() {
  const ctx = createTestContext();
  const customerIds: string[] = [];
  for (const [externalId, name, latLng] of [
    ['C0001', '山田 花子', YAMADA],
    ['C0002', '鈴木 一郎', SUZUKI],
  ] as const) {
    const [familyName = '', givenName = ''] = name.split(' ');
    await ctx.uow.run(ctx.tenantId, (r) =>
      applyCustomerSnapshot(
        { runId: null },
        r,
        {
          source: 'reserva',
          externalId,
          displayName: name,
          familyName,
          givenName,
          attributes: {},
          home: { addressLine: `${name}の住所`, latLng: `${latLng.lat}, ${latLng.lng}` },
          secondary: null,
          emergencyContact: null,
          recipients: [],
        },
        ctx.clock.now,
      ),
    );
    const id = ctx.data().customers.find((c) => c.displayName === name)?.id;
    if (!id) throw new Error('顧客の登録に失敗しました');
    customerIds.push(id);
  }
  const { staff } = await ctx.addStaff('佐藤 美咲', 'misaki@example.com');
  const other = await ctx.addStaff('田中 太郎', 'taro@example.com');
  const row = ctx.data().staff.find((s) => s.record.id === staff.id);
  if (row) {
    row.record.homeAddress = '自宅';
    row.record.homeGeo = HOME;
  }
  const [yamada = '', suzuki = ''] = customerIds;
  const reserve = (id: string, customerId: string, staffId: string, from: string, to: string, date = DATE) =>
    ctx.uow.run(ctx.tenantId, (r) =>
      r.reservations.create({
        id,
        customerId,
        period: { start: jst(from, date), end: jst(to, date) },
        businessDate: date,
        status: 'confirmed',
        assignments: [{ id: `${id}-a`, staffId, confirmedAt: ctx.clock.now }],
      }),
    );
  // 登録の順と時刻の順を変えておく(開始時刻順に返す)
  await reserve('r2', suzuki, staff.id, '13:00', '14:30');
  await reserve('r1', yamada, staff.id, '10:00', '11:30');
  await reserve('r3', yamada, other.staff.id, '10:00', '11:30');
  await reserve('r4', suzuki, staff.id, '10:00', '11:30', '2026-09-26');

  const port = new DatabaseSchedulePort({
    uow: ctx.uow,
    directory: createScheduleDirectory({ uow: ctx.uow }),
  });
  return { ctx, port, staff };
}

describe('DatabaseSchedulePort', () => {
  it('軽量版: そのスタッフのその日の確定した予約を開始時刻順に、顧客の訪問として返す', async () => {
    const { ctx, port, staff } = await setup();
    const result = await port.getSchedule({ staffId: staff.id, staffName: staff.displayName }, DATE, {
      tenantId: ctx.tenantId,
    });
    expect(result).toEqual({
      success: true,
      date: DATE,
      staffName: '佐藤 美咲',
      appointments: [
        {
          title: '山田 花子',
          eventType: 'CUSTOMER APPOINTMENT',
          start: '10:00',
          end: '11:30',
          address: '山田 花子の住所',
        },
        {
          title: '鈴木 一郎',
          eventType: 'CUSTOMER APPOINTMENT',
          start: '13:00',
          end: '14:30',
          address: '鈴木 一郎の住所',
        },
      ],
    });
  });

  it('ルートつき: 区間を緯度経度から見積もり、RESERVA の顧客IDを付ける(部分的な結果は無い)', async () => {
    const { ctx, port, staff } = await setup();
    const result = await port.getScheduleWithRoute(
      { staffId: staff.id, staffName: staff.displayName },
      DATE,
      false,
      { tenantId: ctx.tenantId, fresh: true },
    );
    expect(result.partial).toBeUndefined();
    const [first, second] = result.appointments ?? [];
    const km = (a: typeof HOME, b: typeof HOME) =>
      (estimateRouteLeg(a, b, 'car').distanceMeters / 1000).toFixed(2);
    expect(first).toMatchObject({
      customerName: '山田 花子',
      customerId: 'C0001',
      startTime: '10:00',
      endTime: '11:30',
      attendanceKm: km(HOME, YAMADA),
      moveKm: '',
      leavingKm: '',
    });
    expect(first?.attendanceUrl).toContain('travelmode=driving');
    expect(second).toMatchObject({
      customerName: '鈴木 一郎',
      customerId: 'C0002',
      moveKm: km(YAMADA, SUZUKI),
      leavingKm: km(SUZUKI, HOME),
      attendanceKm: '',
    });
    expect(typeof second?.moveMin).toBe('number');
  });

  it('予約の無い日・知らないスタッフは空、tenantId・日付が無ければ例外', async () => {
    const { ctx, port, staff } = await setup();
    const target = { staffId: staff.id, staffName: staff.displayName };
    expect((await port.getSchedule(target, '2026-09-27', { tenantId: ctx.tenantId })).appointments).toEqual(
      [],
    );
    expect(
      (
        await port.getScheduleWithRoute({ staffId: 'unknown', staffName: '誰か' }, DATE, false, {
          tenantId: ctx.tenantId,
        })
      ).appointments,
    ).toEqual([]);
    await expect(port.getSchedule(target, DATE)).rejects.toThrow('tenantId');
    await expect(port.getSchedule(target, '2026-02-30', { tenantId: ctx.tenantId })).rejects.toThrow(
      'dateString',
    );
  });
});
