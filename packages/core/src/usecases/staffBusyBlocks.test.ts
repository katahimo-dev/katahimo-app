import { describe, expect, it } from 'vitest';
import type { AppLogEntry } from '../ports/appLog';
import type { CalendarBusyResult, GoogleCalendarPort } from '../ports/googleCalendar';
import type { StaffRouteProfileRecord } from '../ports/scheduleDirectory';
import type { BusyBlockInput } from '../ports/staffBusyBlocks';
import { syncStaffBusyBlocks, syncStaffBusyBlocksForAllTenants } from './staffBusyBlocks';

const window = { from: new Date('2026-09-24T15:00:00Z'), to: new Date('2026-10-01T15:00:00Z') };
const profile = (
  id: string,
  calendarId: string | null,
  retirementDate: string | null = null,
): StaffRouteProfileRecord => ({
  id,
  name: id,
  homeAddress: null,
  homeLatLng: null,
  travelMode: null,
  calendarId,
  retirementDate,
});

function setup(staff: StaffRouteProfileRecord[], busy: Map<string, CalendarBusyResult>) {
  const freeBusyCalls: string[][] = [];
  const writes: Array<{ staffId: string; blocks: BusyBlockInput[] }> = [];
  const logs: AppLogEntry[] = [];
  const calendar: GoogleCalendarPort = {
    listEvents: async () => ({ calendarName: '', events: [] }),
    freeBusy: async (ids) => {
      freeBusyCalls.push(ids);
      return busy;
    },
  };
  const deps = {
    calendar,
    staffRouteProfiles: { listByTenant: async () => staff },
    busyBlocks: {
      replaceInWindow: async (
        _t: string,
        staffId: string,
        _s: 'google_calendar',
        _w: unknown,
        blocks: BusyBlockInput[],
      ) => void writes.push({ staffId, blocks }),
    },
    appLog: { write: async (e: AppLogEntry) => void logs.push(e) },
  };
  return { deps, freeBusyCalls, writes, logs };
}

describe('syncStaffBusyBlocks', () => {
  it('calendar_id のある在籍スタッフだけ free/busy を取得して置き換え、失敗したスタッフは続行してWARN', async () => {
    const busy = new Map<string, CalendarBusyResult>([
      ['a@x', { busy: [{ start: new Date('2026-09-25T00:00:00Z'), end: new Date('2026-09-25T02:00:00Z') }] }],
      ['b@x', { busy: [], error: 'free/busyを取得できません: notFound' }],
    ]);
    const { deps, freeBusyCalls, writes, logs } = setup(
      [profile('a', 'a@x'), profile('b', 'b@x'), profile('c', null), profile('retired', 'r@x', '2026-09-01')],
      busy,
    );
    const result = await syncStaffBusyBlocks(deps, 'tenant-1', window, '2026-09-25');

    expect(freeBusyCalls).toEqual([['a@x', 'b@x']]);
    expect(writes).toEqual([
      {
        staffId: 'a',
        blocks: [
          { period: { start: new Date('2026-09-25T00:00:00Z'), end: new Date('2026-09-25T02:00:00Z') } },
        ],
      },
    ]);
    expect(result).toEqual({
      syncedStaffCount: 1,
      failures: [{ staffId: 'b', message: 'free/busyを取得できません: notFound' }],
    });
    expect(logs[0]).toMatchObject({ level: 'WARN', action: 'calendar.busy_blocks.sync' });
  });

  it('free/busy は50カレンダーずつ問い合わせる', async () => {
    const staff = Array.from({ length: 51 }, (_, i) => profile(`s${i}`, `s${i}@x`));
    const { deps, freeBusyCalls } = setup(staff, new Map());
    await syncStaffBusyBlocks(deps, 'tenant-1', window, '2026-09-25');
    expect(freeBusyCalls.map((c) => c.length)).toEqual([50, 1]);
  });

  it('全テナント版は1テナントの例外で他を止めない', async () => {
    const { deps, logs } = setup([profile('a', 'a@x')], new Map([['a@x', { busy: [] }]]));
    const tenants = {
      listAll: async () => [
        { id: 't1', name: '', slug: 't1' },
        { id: 't2', name: '', slug: 't2' },
      ],
      findBySlug: async () => null,
      create: async () => ({ id: '', name: '', slug: '' }),
    };
    let calls = 0;
    const results = await syncStaffBusyBlocksForAllTenants(
      {
        ...deps,
        tenants,
        staffRouteProfiles: {
          listByTenant: async () => {
            calls++;
            if (calls === 1) throw new Error('DB down');
            return [profile('a', 'a@x')];
          },
        },
      },
      window,
    );
    expect(results.get('t1')).toBeInstanceOf(Error);
    expect(results.get('t2')).toEqual({ syncedStaffCount: 1, failures: [] });
    expect(logs.map((l) => l.action)).toEqual([
      'calendar.busy_blocks.sync_error',
      'calendar.busy_blocks.sync',
    ]);
  });
});
