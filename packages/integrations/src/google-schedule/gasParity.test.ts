import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import type { CalendarEvent } from '@katahimo/core/domain';
import type {
  AppLogPort,
  GoogleCalendarPort,
  LatLng,
  MapsPort,
  ScheduleDirectory,
  ScheduleDirectoryPort,
} from '@katahimo/core/ports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryTtlCache } from '../cache';
import { fakeRoute, gasScenario, type Scenario, type ScenarioEvent } from './__fixtures__/gasScenario';
import { GoogleSchedulePort } from './googleSchedulePort';

/**
 * 差分テスト: 本番で動いているGAS版 RouteSearch.js そのもの(legacy submodule)をNodeのvm上で
 * 実行し、同じカレンダー・顧客・スタッフ・地図の入力に対して GoogleSchedulePort と結果が
 * 完全に一致することを確かめる。GAS専用のサービス(CalendarApp/Maps/Utilities/CacheService)は
 * シナリオから同じ値を返す偽物に置き換える。
 */
const ROUTE_SEARCH_JS = fileURLToPath(
  new URL(
    '../../../../legacy/gas-childcare-visit-app/gas-childcare-visit-app/RouteSearch.js',
    import.meta.url,
  ),
);

/** 'YYYY-MM-DD HH:mm'(JST) → Date */
const jst = (value: string) => new Date(`${value.replace(' ', 'T')}:00+09:00`);

function formatJst(date: Date, _timeZone: string, format: string): string {
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString();
  if (format === 'HH:mm') return shifted.slice(11, 16);
  if (format === 'yyyy-MM-dd') return shifted.slice(0, 10);
  throw new Error(`未対応の書式: ${format}`);
}

const overlaps = (event: ScenarioEvent, from: Date, to: Date) =>
  jst(event.start) < to && jst(event.end) > from;

/** GAS版 RouteSearch.js を読み込んだ実行環境(1回のGAS実行に相当)。 */
function loadGasRouteSearch(scenario: Scenario) {
  const geocode = (address: string) => {
    const hit = scenario.geocode[address];
    return hit
      ? { status: 'OK', results: [{ geometry: { location: { lat: hit[0], lng: hit[1] } } }] }
      : { status: 'ZERO_RESULTS', results: [] };
  };
  const context = vm.createContext({
    console: { log() {}, warn() {} },
    CalendarApp: {
      GuestStatus: { NO: 'NO' },
      getAllCalendars: () =>
        scenario.calendars.map((calendar) => ({
          getName: () => calendar.name,
          getEvents: (from: Date, to: Date) =>
            calendar.events
              .filter((e) => overlaps(e, from, to))
              .map((e) => ({
                getMyStatus: () => (e.declined ? 'NO' : 'OWNER'),
                getId: () => e.id,
                getTitle: () => e.title,
                getDescription: () => e.description ?? '',
                getLocation: () => e.location ?? '',
                getStartTime: () => jst(e.start),
                getEndTime: () => jst(e.end),
                getGuestList: () =>
                  (e.guests ?? []).map((g) => ({ getName: () => g.name, getEmail: () => g.email })),
              })),
        })),
    },
    Maps: {
      DirectionFinder: { Mode: { DRIVING: 'driving' } },
      newGeocoder: () => ({ geocode }),
      newDirectionFinder: () => {
        const leg: { origin?: LatLng; destination?: LatLng } = {};
        const finder = {
          setOrigin: (lat: number, lng: number) => {
            leg.origin = { lat, lng };
            return finder;
          },
          setDestination: (lat: number, lng: number) => {
            leg.destination = { lat, lng };
            return finder;
          },
          setMode: () => finder,
          getDirections: () => {
            const route = fakeRoute(leg.origin as LatLng, leg.destination as LatLng);
            return {
              routes: [
                {
                  legs: [
                    { distance: { value: route.distanceMeters }, duration: { value: route.durationSeconds } },
                  ],
                },
              ],
            };
          },
        };
        return finder;
      },
    },
    Utilities: { formatDate: formatJst },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
  });
  vm.runInContext(readFileSync(ROUTE_SEARCH_JS, 'utf8'), context);

  // 顧客CSV・スタッフ台帳の読み込み(Drive/Sheets)は、シナリオのデータをGAS版と同じ形で返す。
  context.getCustomerDataCached_ = () =>
    scenario.customers.map((c) => ({
      id: c.id,
      name: c.name,
      address: c.address,
      parkingarea: '',
      lat: c.latLng?.[0] ?? '',
      lng: c.latLng?.[1] ?? '',
      address2: c.address2?.address ?? '',
      address2_start: c.address2?.start.replaceAll('-', '/') ?? '',
      address2_end: c.address2?.end.replaceAll('-', '/') ?? '',
    }));
  context.getStaffDataCached_ = () =>
    scenario.staff.map((s, i) => ({
      id: `ROW_${i}`,
      name: s.name,
      address: s.address,
      lat: s.latLng?.[0] ?? '',
      lng: s.latLng?.[1] ?? '',
    }));

  return {
    schedule: (staffName: string, date: string) => context.getScheduleForStaffOnDate(staffName, date),
    scheduleWithRoute: (staffName: string, date: string) =>
      context.getScheduleWithRouteForStaffOnDate(staffName, date, true),
  };
}

/** 同じシナリオを新実装の各ポートの偽物として組み立てる。 */
function createGoogleSchedulePort(scenario: Scenario) {
  const toEvent = (e: ScenarioEvent): CalendarEvent => ({
    dedupeKey: e.id,
    title: e.title,
    description: e.description ?? '',
    location: e.location ?? '',
    start: jst(e.start),
    end: jst(e.end),
    allDay: e.allDay ?? false,
    guestNames: (e.guests ?? []).map((g) => g.name || g.email),
    declinedByOwner: e.declined ?? false,
  });
  const calendar: GoogleCalendarPort = {
    async listEvents(calendarId, range) {
      const found = scenario.calendars.find((c) => c.name === calendarId);
      if (!found) throw new Error(`notFound: ${calendarId}`);
      return {
        calendarName: found.name,
        events: found.events.filter((e) => overlaps(e, range.from, range.to)).map(toEvent),
      };
    },
    async freeBusy() {
      return new Map();
    },
  };
  const maps: MapsPort = {
    async geocode(address) {
      const hit = scenario.geocode[address];
      return hit ? { lat: hit[0], lng: hit[1] } : null;
    },
    async route(origin, destination) {
      return fakeRoute(origin, destination);
    },
  };
  const toLatLng = (v?: [number, number]) => (v ? { lat: v[0], lng: v[1] } : null);
  const directory: ScheduleDirectory = {
    customers: scenario.customers.map((c) => ({
      customerId: c.id,
      name: c.name,
      place: {
        address: c.address,
        latLng: toLatLng(c.latLng),
        temporaryAddress: c.address2
          ? { address: c.address2.address, startDate: c.address2.start, endDate: c.address2.end }
          : null,
      },
    })),
    staff: scenario.staff.map((s, i) => ({
      id: `staff-${i}`,
      name: s.name,
      home: { address: s.address, latLng: toLatLng(s.latLng) },
      travelMode: 'car',
      calendarId: null,
    })),
  };
  const directoryPort: ScheduleDirectoryPort = { load: async () => directory };
  const appLog: AppLogPort = { write: async () => {} };
  return new GoogleSchedulePort({
    calendar,
    maps,
    directory: directoryPort,
    routeCache: new InMemoryTtlCache({ maxEntries: 10 }),
    appLog,
    // GAS版の getAllCalendars() と同じ順・同じカレンダー名で読む
    calendarSources: scenario.calendars.map((c) => ({ calendarId: c.name })),
  });
}

const hasLegacySource = existsSync(ROUTE_SEARCH_JS);

describe.skipIf(!hasLegacySource)('GAS版 RouteSearch.js との差分テスト', () => {
  // GAS版は new Date('2026/09/25') と setHours でスクリプトのタイムゾーン(Asia/Tokyo)の0時を作るため、
  // GAS側コードの実行中だけプロセスのタイムゾーンをJSTにする(新実装はタイムゾーンに依存しない)。
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Asia/Tokyo';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  const tenantId = 'tenant-1';
  const staffNames = ['佐藤 美咲', '高橋 由美', '高橋由美', '存在しない スタッフ'];

  it.each(staffNames)('ルートつき予定が一致する: %s', async (staffName) => {
    const gas = loadGasRouteSearch(gasScenario).scheduleWithRoute(staffName, gasScenario.date);
    const port = createGoogleSchedulePort(gasScenario);
    const ours = await port.getScheduleWithRoute(staffName, gasScenario.date, true, { tenantId });
    expect(ours).toEqual(JSON.parse(JSON.stringify(gas)));
  });

  it.each(staffNames)('軽量版の予定一覧が一致する: %s', async (staffName) => {
    const gas = loadGasRouteSearch(gasScenario).schedule(staffName, gasScenario.date);
    const port = createGoogleSchedulePort(gasScenario);
    const ours = await port.getSchedule(staffName, gasScenario.date, { tenantId });
    expect(ours).toEqual(JSON.parse(JSON.stringify(gas)));
  });

  it('シナリオが意図した分岐を通っている(差分テスト自体の確認)', async () => {
    const port = createGoogleSchedulePort(gasScenario);
    const result = await port.getScheduleWithRoute('佐藤 美咲', gasScenario.date, true, { tenantId });
    const rows = result.appointments ?? [];
    expect(rows.map((r) => `${r.startTime} ${r.eventType} ${r.customerName}`)).toEqual([
      '09:00 CUSTOMER APPOINTMENT 山田 花子',
      '11:30 CUSTOMER APPOINTMENT 田中 美和',
      '12:00 OFFICE WORK 日報作成,請求書',
      '13:00 CUSTOMER APPOINTMENT 鈴木 一郎',
      '15:30 OFFICE WORK 打合せ',
      '16:00 CUSTOMER APPOINTMENT 未登録 太郎',
      '17:30 OFFICE WORK 電話対応',
      '19:00 EVENT 全体研修',
      '20:00 CUSTOMER APPOINTMENT 山田 花子',
    ]);
    // 出勤は最初の位置情報ありの予定(09:00)、退勤は最後(20:00)、住所2の期間中は住所2へ向かう
    expect(rows[0]?.attendanceMin).not.toBe('');
    expect(rows[8]?.leavingMin).not.toBe('');
    expect(rows[3]?.moveUrl).toContain('destination=35.5689,139.5577');

    // 終日の[事務]は1日中と重なるため、その日の事務作業をすべて1件にまとめる(GAS版と同じ)
    const takahashi = await port.getScheduleWithRoute('高橋 由美', gasScenario.date, true, { tenantId });
    expect(takahashi.appointments?.map((r) => `${r.startTime}-${r.endTime} ${r.customerName}`)).toEqual([
      '00:00-00:00 棚卸し,打合せ',
      '10:00-11:00 小林様 体験訪問',
      '14:00-15:00 場所未定の体験',
      '16:00-17:00 個人研修',
      '18:00-19:00 山田 花子',
      '19:00-20:00 全体研修',
    ]);
  });
});
