import { describe, expect, it } from 'vitest';
import type { CachePort } from '../ports/cache';
import { applyCustomerSnapshot } from './customers';
import { createScheduleDirectory } from './scheduleDirectory';
import { createTestContext } from './testContext';

class MapCache implements CachePort {
  readonly values = new Map<string, unknown>();
  /** DB から読み直した回数(読み直すたびに set する)。 */
  sets = 0;
  async get<T>(key: string) {
    return this.values.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T) {
    this.sets++;
    this.values.set(key, value);
  }
}

async function setup() {
  const ctx = createTestContext();
  await ctx.uow.run(ctx.tenantId, (r) =>
    applyCustomerSnapshot(
      { runId: null },
      r,
      {
        source: 'reserva',
        externalId: 'C0002',
        displayName: '鈴木 一郎',
        familyName: '鈴木',
        givenName: '一郎',
        attributes: {},
        home: { addressLine: '東京都目黒区自由が丘2-10-1', latLng: '35.6074, 139.6687' },
        secondary: {
          addressLine: '神奈川県横浜市青葉区美しが丘1-1',
          validFrom: '2026-09-20',
          validTo: '2026-09-30',
        },
        emergencyContact: null,
        recipients: [],
      },
      ctx.clock.now,
    ),
  );
  const { staff } = await ctx.addStaff('佐藤 美咲', 'misaki@example.com');
  const row = ctx.data().staff.find((s) => s.record.id === staff.id);
  if (row) {
    row.record.homeAddress = '東京都世田谷区用賀4-1-1';
    row.record.homeGeo = { lat: 35.6264, lng: 139.6336 };
  }
  return { ctx, staffId: staff.id };
}

describe('createScheduleDirectory', () => {
  it('顧客・スタッフを DB から読み、予定計算用の形にする', async () => {
    const { ctx, staffId } = await setup();
    const directory = await createScheduleDirectory(ctx.deps).load(ctx.tenantId);
    expect(directory.customers).toEqual([
      {
        customerId: 'C0002',
        name: '鈴木 一郎',
        place: {
          address: '東京都目黒区自由が丘2-10-1',
          latLng: { lat: 35.6074, lng: 139.6687 },
          temporaryAddress: {
            address: '神奈川県横浜市青葉区美しが丘1-1',
            startDate: '2026-09-20',
            endDate: '2026-09-30',
          },
        },
      },
    ]);
    expect(directory.staff).toEqual([
      {
        id: staffId,
        name: '佐藤 美咲',
        home: { address: '東京都世田谷区用賀4-1-1', latLng: { lat: 35.6264, lng: 139.6336 } },
        travelMode: 'car',
        calendarId: null,
      },
    ]);
  });

  it('キャッシュは顧客データの版数ごと。取込で版数が上がれば読み直す。同時の読み込みは1回にまとめる', async () => {
    const { ctx } = await setup();
    const cache = new MapCache();
    const directory = createScheduleDirectory({ ...ctx.deps, cache });
    await Promise.all([directory.load(ctx.tenantId), directory.load(ctx.tenantId)]);
    expect(cache.sets).toBe(1);
    await directory.load(ctx.tenantId);
    expect(cache.sets).toBe(1);
    await ctx.uow.run(ctx.tenantId, (r) => r.settings.bumpCustomerDataVersion());
    await directory.load(ctx.tenantId);
    expect(cache.sets).toBe(2);
    expect([...cache.values.keys()]).toEqual([
      `schedule-directory:v1:${ctx.tenantId}:0`,
      `schedule-directory:v1:${ctx.tenantId}:1`,
    ]);
  });
});
