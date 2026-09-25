import type { CalendarEvent } from '@katahimo/core/domain';
import { isSameStaffName } from '@katahimo/core/domain';
import type {
  AppLogEntry,
  CalendarEventList,
  GoogleCalendarPort,
  InstantRange,
  LatLng,
  MapsPort,
  RouteOptions,
  ScheduleDirectory,
} from '@katahimo/core/ports';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTtlCache } from '../cache';
import { GoogleSchedulePort } from './googleSchedulePort';

const jst = (value: string) => new Date(`${value.replace(' ', 'T')}:00+09:00`);
const tenantId = 'tenant-1';
const date = '2026-09-25';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    dedupeKey: overrides.title ?? 'e',
    title: '',
    description: '',
    location: '',
    start: jst(`${date} 10:00`),
    end: jst(`${date} 12:00`),
    allDay: false,
    guestNames: [],
    declinedByOwner: false,
    ...overrides,
  };
}

class FakeCalendar implements GoogleCalendarPort {
  calls: Array<{ calendarId: string; range: InstantRange }> = [];
  failing = new Set<string>();
  constructor(private readonly calendars: Record<string, CalendarEventList>) {}
  async listEvents(calendarId: string, range: InstantRange) {
    this.calls.push({ calendarId, range });
    if (this.failing.has(calendarId)) throw new Error('Not Found');
    const found = this.calendars[calendarId];
    if (!found) throw new Error('Not Found');
    return found;
  }
  async freeBusy() {
    return new Map();
  }
}

class FakeMaps implements MapsPort {
  geocodeCalls: string[] = [];
  routeCalls: Array<{ origin: LatLng; destination: LatLng; options?: RouteOptions | undefined }> = [];
  failRoutes = false;
  async geocode(address: string) {
    this.geocodeCalls.push(address);
    return address.includes('不明') ? null : { lat: 35.7, lng: 139.6 };
  }
  async route(origin: LatLng, destination: LatLng, options?: RouteOptions) {
    this.routeCalls.push({ origin, destination, options });
    if (this.failRoutes) throw new Error('Routes API エラー: HTTP 429 RESOURCE_EXHAUSTED');
    return { durationSeconds: 600, distanceMeters: 3210 };
  }
}

const directory: ScheduleDirectory = {
  staff: [
    {
      id: 'staff-sato',
      name: '佐藤 美咲',
      home: { address: '東京都世田谷区用賀4-1-1', latLng: null },
      travelMode: 'bicycle',
      calendarId: 'sato@cutest.biz',
    },
    {
      id: 'staff-other',
      name: '高橋 由美',
      home: { address: '', latLng: null },
      travelMode: 'car',
      calendarId: null,
    },
  ],
  customers: [
    {
      customerId: 'C0001',
      name: '山田 花子',
      place: { address: '東京都世田谷区三軒茶屋1-2-3', latLng: { lat: 35.64, lng: 139.67 } },
    },
  ],
};

/** 呼び出し側(usecase)と同じく、氏名からスタッフIDを解決した対象。 */
const targetOf = (staffName: string) => ({
  staffId: directory.staff.find((s) => isSameStaffName(s.name, staffName))?.id ?? 'staff-unknown',
  staffName,
});

describe('GoogleSchedulePort', () => {
  let calendar: FakeCalendar;
  let maps: FakeMaps;
  let logs: AppLogEntry[];
  let port: GoogleSchedulePort;
  let now: number;

  beforeEach(() => {
    calendar = new FakeCalendar({
      'sato@cutest.biz': {
        calendarName: 'sato@cutest.biz',
        events: [
          event({
            title: '[事務]請求書',
            location: '東京都渋谷区道玄坂1-1',
            start: jst(`${date} 14:00`),
            end: jst(`${date} 15:00`),
          }),
        ],
      },
      'reserva@group.calendar.google.com': {
        calendarName: 'RESERVA予約',
        events: [event({ title: '[予約確定]山田 花子', description: '施設：佐藤 美咲[訪問保育]' })],
      },
    });
    maps = new FakeMaps();
    logs = [];
    now = 0;
    port = new GoogleSchedulePort({
      calendar,
      maps,
      directory: { load: async () => directory },
      routeCache: new InMemoryTtlCache({ maxEntries: 100, now: () => now }),
      appLog: { write: async (entry) => void logs.push(entry) },
      calendarSources: [{ calendarId: 'reserva@group.calendar.google.com' }],
    });
  });

  it('staff.calendar_id と GOOGLE_CALENDAR_IDS のカレンダーをJSTの1日の範囲で読み、スタッフの予定を返す', async () => {
    const result = await port.getSchedule(targetOf('佐藤美咲'), date, { tenantId });
    expect(result).toEqual({
      success: true,
      date,
      staffName: '佐藤 美咲',
      appointments: [
        {
          title: '山田 花子',
          eventType: 'CUSTOMER APPOINTMENT',
          start: '10:00',
          end: '12:00',
          address: '東京都世田谷区三軒茶屋1-2-3',
        },
        {
          title: '請求書',
          eventType: 'OFFICE WORK',
          start: '14:00',
          end: '15:00',
          address: '東京都渋谷区道玄坂1-1',
        },
      ],
    });
    expect(calendar.calls.map((c) => c.calendarId)).toEqual([
      'sato@cutest.biz',
      'reserva@group.calendar.google.com',
    ]);
    expect(calendar.calls[0]?.range).toEqual({
      from: new Date('2026-09-24T15:00:00Z'),
      to: new Date('2026-09-25T15:00:00Z'),
    });
    // 軽量版は地図APIを呼ばない
    expect(maps.geocodeCalls).toEqual([]);
  });

  it('ルートはスタッフの移動手段で計算し、同じ住所のジオコーディングは1回にまとめる', async () => {
    const result = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const [visit, office] = result.appointments ?? [];
    expect(visit).toMatchObject({ attendanceMin: 10, attendanceKm: '3.21', moveMin: '', leavingMin: '' });
    expect(visit?.attendanceUrl).toContain('travelmode=bicycling');
    expect(office).toMatchObject({ moveMin: 10, moveKm: '3.21', leavingMin: 10, leavingKm: '3.21' });
    expect(maps.routeCalls.every((c) => c.options?.travelMode === 'bicycle')).toBe(true);
    // 自宅(1回)・請求書の場所(移動と退勤で2回使うが1回)
    expect(maps.geocodeCalls.sort()).toEqual(['東京都世田谷区用賀4-1-1', '東京都渋谷区道玄坂1-1'].sort());
  });

  it('閲覧は2時間キャッシュし、期限内は再計算しない。期限切れで再計算する', async () => {
    const first = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const callsAfterFirst = calendar.calls.length;
    now = 2 * 60 * 60 * 1000 - 1;
    expect(await port.getScheduleWithRoute(targetOf('佐藤　美咲'), date, false, { tenantId })).toEqual(first);
    expect(calendar.calls.length).toBe(callsAfterFirst);
    now = 2 * 60 * 60 * 1000;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(calendar.calls.length).toBe(callsAfterFirst * 2);
  });

  it('forceRefresh はキャッシュを読まずに再計算し、結果をキャッシュに書き直す', async () => {
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    maps.failRoutes = true;
    const refreshed = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, true, { tenantId });
    expect(refreshed.appointments?.[0]?.attendanceMin).toBe('');
    const calls = calendar.calls.length;
    expect(await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId })).toEqual(
      refreshed,
    );
    expect(calendar.calls.length).toBe(calls);
  });

  it('fresh(勤怠記録の書き込み用)はキャッシュを読みも書きもしない', async () => {
    const cached = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    maps.failRoutes = true;
    const fresh = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, {
      tenantId,
      fresh: true,
    });
    expect(fresh.appointments?.[0]?.attendanceMin).toBe('');
    expect(await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId })).toEqual(cached);
  });

  it('経路計算の失敗は空欄にして続け、WARNで記録する(住所は記録しない)', async () => {
    maps.failRoutes = true;
    const result = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(result.success).toBe(true);
    expect(
      result.appointments?.every((a) => a.attendanceMin === '' && a.moveMin === '' && a.leavingMin === ''),
    ).toBe(true);
    expect(logs).toEqual([
      expect.objectContaining({
        level: 'WARN',
        action: 'schedule.route_leg_failed',
        targetStaffId: 'staff-sato',
        details: {
          date,
          failures: expect.arrayContaining(['route: Routes API エラー: HTTP 429 RESOURCE_EXHAUSTED']),
        },
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain('道玄坂');
  });

  it('読めないカレンダーは閲覧ではWARNを残して飛ばし、freshでは失敗させる(予定が欠けたまま記録しないため)', async () => {
    calendar.failing.add('reserva@group.calendar.google.com');
    const view = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(view.appointments?.map((a) => a.customerName)).toEqual(['請求書']);
    expect(logs[0]).toMatchObject({
      level: 'WARN',
      action: 'schedule.calendar_read_failed',
      details: { calendarId: 'reserva@group.calendar.google.com', message: 'Not Found' },
    });
    await expect(
      port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId, fresh: true }),
    ).rejects.toThrow('カレンダーを読み込めませんでした');
  });

  it('スタッフ台帳に居ない名前は予定なし(カレンダーも読まない)', async () => {
    expect(await port.getScheduleWithRoute(targetOf('不明 太郎'), date, false, { tenantId })).toEqual({
      success: true,
      date,
      staffName: '不明 太郎',
      appointments: [],
    });
    expect(calendar.calls).toEqual([]);
  });

  it('入力の検証はGAS版と同じメッセージの例外。tenantId が無ければ例外', async () => {
    await expect(port.getSchedule({ staffId: '', staffName: ' ' }, date, { tenantId })).rejects.toThrow(
      '対象のスタッフが指定されていません。',
    );
    await expect(port.getSchedule(targetOf('佐藤 美咲'), '2026/09/25', { tenantId })).rejects.toThrow(
      'dateString が不正です。YYYY-MM-DD 形式で指定してください。',
    );
    await expect(port.getSchedule(targetOf('佐藤 美咲'), date)).rejects.toThrow('tenantId');
  });
});
