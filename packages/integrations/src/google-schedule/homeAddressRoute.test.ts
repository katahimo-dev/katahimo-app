import type { CalendarEvent } from '@katahimo/core/domain';
import { COMMUTE_DISTANCE_COLUMN, LEAVING_DISTANCE_COLUMN } from '@katahimo/core/domain';
import type { LatLng, MapsPort } from '@katahimo/core/ports';
import { createTestContext } from '@katahimo/core/test-utils';
import {
  applyCalendarSync,
  createScheduleDirectory,
  createStaffByAdmin,
  getAttendanceDay,
  getScheduleWithRouteForStaff,
} from '@katahimo/core/usecases';
import { describe, expect, it } from 'vitest';
import { InMemoryTtlCache } from '../cache';
import { GoogleSchedulePort } from './googleSchedulePort';

const DATE = '2026-09-24';
const HOME = '東京都世田谷区用賀4-1-1';
const jst = (time: string) => new Date(`${DATE}T${time}:00+09:00`);

/** 住所 → 緯度経度(自宅の住所だけ別の点)。経路はどこでも 12分・4.56km。 */
class FakeMaps implements MapsPort {
  geocodeCalls: string[] = [];
  async geocode(address: string): Promise<LatLng | null> {
    this.geocodeCalls.push(address);
    return address === HOME ? { lat: 35.6264, lng: 139.6336 } : { lat: 35.66, lng: 139.7 };
  }
  async route() {
    return { durationSeconds: 720, distanceMeters: 4560 };
  }
}

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    dedupeKey: overrides.title ?? 'e',
    title: '',
    description: '',
    location: '',
    start: jst('10:00'),
    end: jst('12:00'),
    allDay: false,
    guestNames: [],
    declinedByOwner: false,
    ...overrides,
  };
}

/**
 * 自宅の住所だけ(緯度経度なし)のスタッフでも、DB のマスタ → 予定のルート計算 → 出勤簿の出勤・退勤距離まで
 * つながることを、本番と同じ部品(createScheduleDirectory・GoogleSchedulePort・カレンダー反映)で確かめる
 * (GAS版 RouteSearch.js はスタッフ台帳の住所をジオコーディングして出勤・退勤経路を出していた)。
 */
describe('自宅住所だけのスタッフの出勤・退勤経路', () => {
  it('予定のルートに出勤・退勤経路が付き、カレンダー反映で出勤簿の出勤・退勤距離が入る', async () => {
    const ctx = createTestContext();
    const admin = await ctx.addStaff('管理 者', 'admin@example.com', 'admin');
    // 地図APIの無い管理画面で登録した(住所だけで緯度経度なし)
    const { staff } = await createStaffByAdmin(ctx.deps, admin.actor, {
      name: '佐藤 美咲',
      email: 'misaki@example.com',
      role: 'staff',
      homeAddress: HOME,
    });
    expect(staff).toMatchObject({ homeAddress: HOME, hasHomeGeo: false });
    await ctx.addCustomer('山田 花子', 'C0001');
    ctx.db.calendarSettings.set(ctx.tenantId, {
      sharedCalendars: [{ calendarId: 'reserva@group.calendar.google.com' }],
      allowedStaffCalendars: [],
    });

    const maps = new FakeMaps();
    const schedule = new GoogleSchedulePort({
      calendar: {
        async listEvents() {
          return {
            calendarName: 'RESERVA予約',
            events: [
              event({ title: '[予約確定]山田 花子', description: '施設：佐藤 美咲[訪問保育]' }),
              event({
                title: '[予約確定]山田 花子',
                dedupeKey: 'second',
                description: '施設：佐藤 美咲[訪問保育]',
                start: jst('14:00'),
                end: jst('15:00'),
              }),
            ],
          };
        },
        async freeBusy() {
          return new Map();
        },
      },
      maps,
      directory: createScheduleDirectory({ uow: ctx.uow }),
      mapsCache: new InMemoryTtlCache({ maxEntries: 10 }),
      appLog: ctx.appLog,
    });
    const deps = { ...ctx.deps, schedule };

    const view = await getScheduleWithRouteForStaff(deps, {
      tenantId: ctx.tenantId,
      actorStaffId: admin.actor.staffId,
      targetStaffId: staff.id,
      date: DATE,
      forceRefresh: false,
    });
    const [first, last] = view.appointments ?? [];
    expect(first).toMatchObject({ attendanceMin: 12, attendanceKm: '4.56', leavingKm: '' });
    expect(last).toMatchObject({ moveKm: '4.56', leavingMin: 12, leavingKm: '4.56' });
    expect(maps.geocodeCalls).toContain(HOME);

    await applyCalendarSync(deps, admin.actor, staff.id, DATE);
    const day = await getAttendanceDay(deps, admin.actor, staff.id, DATE);
    expect(day.rowData[COMMUTE_DISTANCE_COLUMN]).toBe('4.56');
    expect(day.rowData[LEAVING_DISTANCE_COLUMN]).toBe('4.56');
    expect(
      ctx
        .data()
        .legs.filter((l) => l.staffId === staff.id)
        .map((l) => l.kind),
    ).toEqual(expect.arrayContaining(['commute', 'return']));
  });
});
