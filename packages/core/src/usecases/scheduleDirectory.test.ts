import { describe, expect, it } from 'vitest';
import type { StaffRouteProfileRecord } from '../ports/scheduleDirectory';
import { createScheduleDirectory } from './scheduleDirectory';
import { FakeCryptoPort, FakeCustomerRepository } from './testDoubles';

describe('createScheduleDirectory', () => {
  it('顧客・スタッフをDBから読み、緯度経度を復号して予定計算用の形にする', async () => {
    const tenantId = 'tenant-1';
    const crypto = new FakeCryptoPort();
    const customers = new FakeCustomerRepository();
    await customers.create({
      tenantId,
      name: '鈴木 一郎',
      familyName: '鈴木',
      givenName: '一郎',
      externalSource: 'reserva',
      externalId: 'C0002',
      addressDetail: '東京都目黒区自由が丘2-10-1',
      address2: '神奈川県横浜市青葉区美しが丘1-1',
      address2StartDate: '2026-09-20',
      address2EndDate: '2026-09-30',
      latLng: await crypto.encrypt(tenantId, '35.6074, 139.6687'),
    });
    await customers.create({
      tenantId,
      name: '手動 登録',
      familyName: '手動',
      givenName: '登録',
      address2: '期間なし',
    });

    const staffRows: StaffRouteProfileRecord[] = [
      {
        id: 's1',
        name: '佐藤 美咲',
        homeAddress: '東京都世田谷区用賀4-1-1',
        homeLatLng: await crypto.encrypt(tenantId, '35.6264,139.6336'),
        travelMode: null,
        calendarId: 'sato@cutest.biz',
        retirementDate: null,
      },
      {
        id: 's2',
        name: '高橋 由美',
        homeAddress: null,
        homeLatLng: null,
        travelMode: 'transit',
        calendarId: null,
        retirementDate: null,
      },
    ];

    const directory = await createScheduleDirectory({
      customers,
      staffRouteProfiles: { listByTenant: async () => staffRows },
      crypto,
    }).load(tenantId);

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
      { customerId: '', name: '手動 登録', place: { address: '', latLng: null, temporaryAddress: null } },
    ]);
    expect(directory.staff).toEqual([
      {
        id: 's1',
        name: '佐藤 美咲',
        home: { address: '東京都世田谷区用賀4-1-1', latLng: { lat: 35.6264, lng: 139.6336 } },
        travelMode: 'car',
        calendarId: 'sato@cutest.biz',
      },
      {
        id: 's2',
        name: '高橋 由美',
        home: { address: '', latLng: null },
        travelMode: 'transit',
        calendarId: null,
      },
    ]);
  });
});
