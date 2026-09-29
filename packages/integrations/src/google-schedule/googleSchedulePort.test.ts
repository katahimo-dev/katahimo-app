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
  constructor(readonly calendars: Record<string, CalendarEventList>) {}
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
  routeResult: { durationSeconds: number; distanceMeters: number } | null = {
    durationSeconds: 600,
    distanceMeters: 3210,
  };
  async geocode(address: string) {
    this.geocodeCalls.push(address);
    return address.includes('不明') ? null : { lat: 35.7, lng: 139.6 };
  }
  async route(origin: LatLng, destination: LatLng, options?: RouteOptions) {
    this.routeCalls.push({ origin, destination, options });
    if (this.failRoutes) throw new Error('Routes API エラー: HTTP 429 RESOURCE_EXHAUSTED');
    return this.routeResult;
  }
}

const directory: ScheduleDirectory = {
  calendarSettings: {
    sharedCalendars: [{ calendarId: 'reserva@group.calendar.google.com' }],
    allowedStaffCalendars: ['@cutest.biz'],
  },
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
      recordId: 'customer-c0001',
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
      mapsCache: new InMemoryTtlCache({ maxEntries: 100, now: () => now }),
      calendarCache: new InMemoryTtlCache({ maxEntries: 100, now: () => now }),
      appLog: { write: async (entry) => void logs.push(entry) },
    });
  });

  it('スタッフのカレンダーとテナントの共有カレンダーをJSTの1日の範囲で読み、スタッフの予定を返す', async () => {
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

  it('閲覧でも予定はカレンダーから読み直す(担当変更は60秒の短期キャッシュの後に出る)。地図の結果は区間・住所ごとに6時間使い回す', async () => {
    const first = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const calendarCalls = calendar.calls.length;
    const routeCalls = maps.routeCalls.length;
    const geocodeCalls = maps.geocodeCalls.length;
    expect(routeCalls).toBeGreaterThan(0);

    // 担当が変わった(共有カレンダーの予定が別のスタッフになった)
    calendar.calendars['reserva@group.calendar.google.com'] = {
      calendarName: 'RESERVA予約',
      events: [event({ title: '[予約確定]山田 花子', description: '施設：高橋 由美[訪問保育]' })],
    };

    now = 60 * 1000;
    const second = await port.getScheduleWithRoute(targetOf('佐藤　美咲'), date, false, { tenantId });
    expect(calendar.calls.length).toBe(calendarCalls * 2);
    expect(second.appointments?.map((a) => a.customerName)).toEqual(['請求書']);
    expect(first.appointments?.map((a) => a.customerName)).toEqual(['山田 花子', '請求書']);
    // 一度調べた住所・区間は地図APIを呼ばずにキャッシュから(予定は読み直しても地図の従量課金は増えない)
    expect(maps.routeCalls.length).toBe(routeCalls);
    expect(maps.geocodeCalls.length).toBe(geocodeCalls);

    now = 6 * 60 * 60 * 1000;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(maps.routeCalls.length).toBeGreaterThan(routeCalls);
    expect(maps.geocodeCalls.length).toBeGreaterThan(geocodeCalls);
  });

  it('forceRefresh は地図の結果のキャッシュを読まずに調べ直し、結果をキャッシュに書き直す', async () => {
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const routeCalls = maps.routeCalls.length;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, true, { tenantId });
    const afterRefresh = maps.routeCalls.length;
    expect(afterRefresh).toBe(routeCalls * 2);
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(maps.routeCalls.length).toBe(afterRefresh);
  });

  it('失敗した区間はキャッシュせず、次の閲覧で問い合わせ直す', async () => {
    maps.failRoutes = true;
    const failed = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(failed.appointments?.[0]?.attendanceMin).toBe('');
    const routeCalls = maps.routeCalls.length;
    maps.failRoutes = false;
    const retried = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(maps.routeCalls.length).toBe(routeCalls * 2);
    expect(retried.appointments?.[0]?.attendanceMin).toBe(10);
  });

  it('fresh(勤怠記録の書き込み用)は地図の結果のキャッシュを読みも書きもしない', async () => {
    const cached = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const routeCalls = maps.routeCalls.length;
    maps.failRoutes = true;
    const fresh = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, {
      tenantId,
      fresh: true,
    });
    // キャッシュにある区間も地図APIに問い合わせる(ここでは失敗させて空欄になることで確かめる)
    expect(maps.routeCalls.length).toBe(routeCalls * 2);
    expect(fresh.appointments?.[0]?.attendanceMin).toBe('');
    // fresh の結果はキャッシュに書かれず、閲覧は前のキャッシュのまま
    expect(await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId })).toEqual(cached);
  });

  it('fresh の結果はキャッシュに書かない(fresh の後の閲覧は地図APIに問い合わせ、fresh の値を読まない)', async () => {
    const fresh = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, {
      tenantId,
      fresh: true,
    });
    expect(fresh.appointments?.[0]?.attendanceMin).toBe(10);
    const routeCalls = maps.routeCalls.length;
    maps.routeResult = { durationSeconds: 1200, distanceMeters: 5000 };
    const view = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(maps.routeCalls.length).toBe(routeCalls * 2);
    expect(view.appointments?.[0]).toMatchObject({ attendanceMin: 20, attendanceKm: '5.00' });
  });

  it('見つからなかった経路(null)は30分だけ覚え、開くたびに問い合わせ直さない(fresh は使わない)', async () => {
    maps.routeResult = null;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const routeCalls = maps.routeCalls.length;
    now = 30 * 60 * 1000 - 1;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(maps.routeCalls.length).toBe(routeCalls);
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId, fresh: true });
    expect(maps.routeCalls.length).toBe(routeCalls * 2);
    now = 30 * 60 * 1000;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(maps.routeCalls.length).toBe(routeCalls * 3);
  });

  it('地図APIを実際に呼んだ回数とキャッシュで済ませた回数を onMapsUsage で知らせる', async () => {
    const usages: unknown[] = [];
    const onMapsUsage = (usage: unknown) => void usages.push(usage);
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId, onMapsUsage });
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId, onMapsUsage });
    expect(usages[0]).toEqual({ geocodeCalls: 2, routeCalls: maps.routeCalls.length, cacheHits: 0 });
    expect(usages[1]).toMatchObject({ geocodeCalls: 0, routeCalls: 0 });
    expect((usages[1] as { cacheHits: number }).cacheHits).toBeGreaterThan(0);
  });

  it('閲覧のカレンダーの読み込みは60秒だけ使い回す。🔄(forceRefresh)・strict・fresh は読み直す', async () => {
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const perView = calendar.calls.length;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    await port.getSchedule(targetOf('佐藤 美咲'), date, { tenantId });
    expect(calendar.calls.length).toBe(perView);

    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, true, { tenantId });
    expect(calendar.calls.length).toBe(perView * 2);
    await port.getSchedule(targetOf('佐藤 美咲'), date, { tenantId, strict: true });
    expect(calendar.calls.length).toBe(perView * 3);
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId, fresh: true });
    expect(calendar.calls.length).toBe(perView * 4);

    now = 60 * 1000;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(calendar.calls.length).toBe(perView * 5);
    // 日時は ISO 文字列で入れて Date に戻す(キャッシュからの結果も同じ)
    now = 60 * 1000 + 1;
    const cached = await port.getSchedule(targetOf('佐藤 美咲'), date, { tenantId });
    expect(calendar.calls.length).toBe(perView * 5);
    expect(cached.appointments?.[0]).toMatchObject({ start: '10:00', end: '12:00' });
  });

  it('閲覧で読めないカレンダーがあれば partial を付け、読めなかった分は覚えない', async () => {
    calendar.failing.add('reserva@group.calendar.google.com');
    const view = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(view.partial).toBe(true);
    expect((await port.getSchedule(targetOf('佐藤 美咲'), date, { tenantId })).partial).toBe(true);
    calendar.failing.clear();
    const recovered = await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    expect(recovered.partial).toBeUndefined();
    expect(recovered.appointments?.map((a) => a.customerName)).toEqual(['山田 花子', '請求書']);
  });

  it('地図の結果のキャッシュはテナントをまたいで使い回さない', async () => {
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId });
    const routeCalls = maps.routeCalls.length;
    await port.getScheduleWithRoute(targetOf('佐藤 美咲'), date, false, { tenantId: 'tenant-2' });
    expect(maps.routeCalls.length).toBe(routeCalls * 2);
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

  it('軽量版も strict(翌日の予定のお知らせ)なら読めないカレンダーで失敗させる', async () => {
    calendar.failing.add('reserva@group.calendar.google.com');
    const view = await port.getSchedule(targetOf('佐藤 美咲'), date, { tenantId });
    expect(view.appointments?.map((a) => a.title)).toEqual(['請求書']);
    await expect(port.getSchedule(targetOf('佐藤 美咲'), date, { tenantId, strict: true })).rejects.toThrow(
      'カレンダーを読み込めませんでした',
    );
  });

  it('許可の一覧から外れたスタッフのカレンダーは読まず、そのスタッフの予定を見たときに WARN を残す', async () => {
    port = new GoogleSchedulePort({
      calendar,
      maps,
      directory: {
        load: async () => ({
          ...directory,
          calendarSettings: { ...directory.calendarSettings, allowedStaffCalendars: ['@other.example'] },
        }),
      },
      mapsCache: new InMemoryTtlCache({ maxEntries: 10, now: () => now }),
      calendarCache: new InMemoryTtlCache({ maxEntries: 10, now: () => now }),
      appLog: { write: async (entry) => void logs.push(entry) },
    });
    const result = await port.getSchedule(targetOf('佐藤 美咲'), date, { tenantId });
    expect(calendar.calls.map((c) => c.calendarId)).toEqual(['reserva@group.calendar.google.com']);
    expect((result.appointments ?? []).map((a) => a.title)).toEqual(['山田 花子']);
    expect(logs).toEqual([
      expect.objectContaining({
        level: 'WARN',
        action: 'calendar.staff_calendar_not_allowed',
        targetStaffId: 'staff-sato',
      }),
    ]);
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

describe('GoogleSchedulePort の読むカレンダー(閲覧は他のスタッフのカレンダーを読まない、strict / fresh は全部)', () => {
  const staffOf = (id: string, name: string, calendarId: string | null) => ({
    id,
    name,
    calendarId,
    home: { address: '', latLng: null },
    travelMode: 'car' as const,
  });
  const wide: ScheduleDirectory = {
    calendarSettings: {
      sharedCalendars: [
        // doc/09 の移行手順どおり持ち主名を付けた予約カレンダー(持ち主名が他のスタッフでも閲覧で読む)
        { calendarId: 'reserva@group.calendar.google.com', ownerName: '高橋 由美' },
        // 持ち主名の指定が無く、カレンダー名が他のスタッフの名前の共有カレンダー
        { calendarId: 'takahashi-team@group.calendar.google.com' },
      ],
      allowedStaffCalendars: ['@cutest.biz'],
    },
    staff: [
      staffOf('staff-sato', '佐藤 美咲', 'sato@cutest.biz'),
      staffOf('staff-takahashi', '高橋 由美', 'takahashi@cutest.biz'),
      staffOf('staff-suzuki', '鈴木 花', 'sato@cutest.biz'),
      staffOf('staff-blocked', '伊藤 誠', 'ito@blocked.example'),
    ],
    customers: [],
  };
  const shared = ['reserva@group.calendar.google.com', 'takahashi-team@group.calendar.google.com'];
  const all = ['sato@cutest.biz', 'takahashi@cutest.biz', ...shared];
  let calendar: FakeCalendar;
  let logs: AppLogEntry[];
  let port: GoogleSchedulePort;

  beforeEach(() => {
    calendar = new FakeCalendar({
      'sato@cutest.biz': { calendarName: 'sato@cutest.biz', events: [] },
      'takahashi@cutest.biz': {
        calendarName: 'takahashi@cutest.biz',
        events: [
          // 他スタッフのカレンダーに手作業で作った「施設：佐藤 美咲」の予定(閲覧では取りこぼす例外)
          event({ title: '[予約確定]手作業', description: '施設：佐藤 美咲[訪問保育]', dedupeKey: 'manual' }),
        ],
      },
      'reserva@group.calendar.google.com': {
        calendarName: 'RESERVA予約',
        events: [
          event({
            title: '[予約確定]山田 花子',
            description: '施設：佐藤 美咲[訪問保育]',
            dedupeKey: 'reserva',
            start: jst(`${date} 13:00`),
            end: jst(`${date} 14:00`),
          }),
        ],
      },
      'takahashi-team@group.calendar.google.com': {
        calendarName: '高橋 由美',
        events: [
          event({ title: '[事務]高橋さんの事務', dedupeKey: 'team-office' }),
          event({
            title: '[予約確定]共有',
            description: '施設：佐藤 美咲[訪問保育]',
            dedupeKey: 'team-reserva',
            start: jst(`${date} 16:00`),
            end: jst(`${date} 17:00`),
          }),
        ],
      },
    });
    logs = [];
    port = new GoogleSchedulePort({
      calendar,
      maps: new FakeMaps(),
      directory: { load: async () => wide },
      mapsCache: new InMemoryTtlCache({ maxEntries: 100 }),
      calendarCache: new InMemoryTtlCache({ maxEntries: 100 }),
      appLog: { write: async (entry) => void logs.push(entry) },
    });
  });
  const read = () => [...new Set(calendar.calls.map((c) => c.calendarId))].sort();
  const sato = { staffId: 'staff-sato', staffName: '佐藤 美咲' };
  const takahashi = { staffId: 'staff-takahashi', staffName: '高橋 由美' };

  it('閲覧は自分のカレンダーと共有カレンダー全部(持ち主名が他のスタッフでも)を読み、他のスタッフのカレンダーは読まない', async () => {
    const result = await port.getSchedule(sato, date, { tenantId });
    expect(read()).toEqual(['sato@cutest.biz', ...shared].sort());
    // 持ち主名が他のスタッフの予約カレンダーの [予約確定] も「施設：」で自分の予定になる。
    // 持ち主名の無い共有カレンダー(カレンダー名 = 他のスタッフ名)の [事務] はそのスタッフの分で出ない
    expect(result.appointments?.map((a) => a.title)).toEqual(['山田 花子', '共有']);
  });

  it('🔄(forceRefresh)も読むカレンダーの集合は閲覧と同じに絞る', async () => {
    const result = await port.getScheduleWithRoute(sato, date, true, { tenantId });
    expect(read()).toEqual(['sato@cutest.biz', ...shared].sort());
    expect(result.appointments?.map((a) => a.customerName)).toEqual(['山田 花子', '共有']);
  });

  it('持ち主名の無い共有カレンダーはカレンダー名が持ち主になる(そのスタッフの閲覧では [事務] が出る)', async () => {
    const result = await port.getSchedule(takahashi, date, { tenantId });
    expect(read()).toEqual(['takahashi@cutest.biz', ...shared].sort());
    expect(result.appointments?.map((a) => a.title)).toEqual(['高橋さんの事務']);
  });

  it('strict(翌日の予定のお知らせ)と fresh(出勤簿への同期)は全カレンダーを読み、他スタッフのカレンダーの予定も拾う', async () => {
    const strict = await port.getSchedule(sato, date, { tenantId, strict: true });
    expect(read()).toEqual([...all].sort());
    expect(strict.appointments?.map((a) => a.title)).toEqual(['手作業', '山田 花子', '共有']);
    calendar.calls = [];
    const fresh = await port.getScheduleWithRoute(sato, date, false, { tenantId, fresh: true });
    expect(read()).toEqual([...all].sort());
    expect(fresh.appointments?.map((a) => a.customerName)).toEqual(['手作業', '山田 花子', '共有']);
  });

  it('同じカレンダーを複数のスタッフが設定していれば、後のスタッフの閲覧でもそのカレンダーを読む', async () => {
    await port.getSchedule({ staffId: 'staff-suzuki', staffName: '鈴木 花' }, date, { tenantId });
    expect(read()).toEqual(['sato@cutest.biz', ...shared].sort());
  });

  it('同じ予定(iCalUID)が複数のスタッフのカレンダーにあると、閲覧と fresh で持ち主が変わり予定タブにだけ出ることがある', async () => {
    // 佐藤さんが作って高橋さんのカレンダーにも載った [事務](全体では先に読む佐藤さんのカレンダーが持ち主)
    const copied = event({
      title: '[事務]打合せ',
      dedupeKey: 'copied',
      start: jst(`${date} 08:00`),
      end: jst(`${date} 09:00`),
    });
    calendar.calendars['sato@cutest.biz'] = { calendarName: 'sato@cutest.biz', events: [copied] };
    calendar.calendars['takahashi@cutest.biz'] = { calendarName: 'takahashi@cutest.biz', events: [copied] };
    const view = await port.getSchedule(takahashi, date, { tenantId });
    expect(view.appointments?.map((a) => a.title)).toEqual(['打合せ', '高橋さんの事務']);
    const fresh = await port.getScheduleWithRoute(takahashi, date, false, { tenantId, fresh: true });
    expect(fresh.appointments?.map((a) => a.customerName)).toEqual(['高橋さんの事務']);
  });

  it('閲覧の WARN は対象スタッフの分だけ(他のスタッフの許可外・読めないカレンダーは記録しない)', async () => {
    calendar.failing.add('takahashi@cutest.biz');
    await port.getSchedule(sato, date, { tenantId });
    expect(logs).toEqual([]);
    await port.getSchedule({ staffId: 'staff-blocked', staffName: '伊藤 誠' }, date, { tenantId });
    expect(logs).toEqual([
      expect.objectContaining({
        action: 'calendar.staff_calendar_not_allowed',
        targetStaffId: 'staff-blocked',
      }),
    ]);
    expect(read()).not.toContain('ito@blocked.example');
  });
});
