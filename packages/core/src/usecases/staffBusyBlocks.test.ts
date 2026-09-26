import { describe, expect, it } from 'vitest';
import type { CalendarBusyResult, GoogleCalendarPort } from '../ports/googleCalendar';
import { syncStaffBusyBlocks, syncStaffBusyBlocksForAllTenants } from './staffBusyBlocks';
import { createTestContext } from './testContext';

const window = { from: new Date('2026-09-24T15:00:00Z'), to: new Date('2026-10-01T15:00:00Z') };
const block = { start: new Date('2026-09-25T01:00:00Z'), end: new Date('2026-09-25T03:00:00Z') };

async function setup(busy: Map<string, CalendarBusyResult>) {
  const ctx = createTestContext();
  ctx.db.calendarSettings.set(ctx.tenantId, {
    sharedCalendars: [],
    allowedStaffCalendars: ['@cutest.co.jp'],
  });
  const freeBusyCalls: string[][] = [];
  const calendar: GoogleCalendarPort = {
    listEvents: async () => ({ calendarName: '', events: [] }),
    freeBusy: async (ids) => {
      freeBusyCalls.push(ids);
      return busy;
    },
  };
  const a = (await ctx.addStaff('A', 'a@example.com')).staff.id;
  const b = (await ctx.addStaff('B', 'b@example.com')).staff.id;
  const retired = (await ctx.addStaff('C', 'c@example.com')).staff.id;
  ctx.setRetiredOn(retired, '2026-01-01');
  await ctx.uow.run(ctx.tenantId, async (r) => {
    await r.staffCalendars.setScheduleCalendar(a, 'a@cutest.co.jp', '00000000-0000-7000-8000-0000000000c1');
    await r.staffCalendars.setScheduleCalendar(b, 'b@cutest.co.jp', '00000000-0000-7000-8000-0000000000c2');
    await r.staffCalendars.setScheduleCalendar(
      retired,
      'c@cutest.co.jp',
      '00000000-0000-7000-8000-0000000000c3',
    );
  });
  return { ctx, deps: { ...ctx.deps, calendar }, freeBusyCalls, a, b };
}

describe('syncStaffBusyBlocks', () => {
  it('在籍スタッフのカレンダーだけを問い合わせ、失敗したスタッフは置き換えずに WARN を残す', async () => {
    const { ctx, deps, freeBusyCalls, a, b } = await setup(
      new Map([
        ['a@cutest.co.jp', { busy: [block] }],
        ['b@cutest.co.jp', { busy: [], error: 'notFound' }],
      ]),
    );
    const result = await syncStaffBusyBlocks(deps, ctx.tenantId, window, '2026-09-25');
    expect(freeBusyCalls).toEqual([['a@cutest.co.jp', 'b@cutest.co.jp']]);
    expect(result).toEqual({ syncedStaffCount: 1, failures: [{ staffId: b, message: 'notFound' }] });
    expect(ctx.data().busyBlocks).toEqual([{ staffId: a, ...block }]);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({ level: 'WARN', action: 'calendar.busy_blocks.sync' });
  });

  it('許可の一覧に合わなくなったカレンダーは問い合わせず、WARN を残す', async () => {
    const { ctx, deps, freeBusyCalls, b } = await setup(new Map([['a@cutest.co.jp', { busy: [] }]]));
    ctx.db.calendarSettings.set(ctx.tenantId, {
      sharedCalendars: [],
      allowedStaffCalendars: ['a@cutest.co.jp'],
    });
    const result = await syncStaffBusyBlocks(deps, ctx.tenantId, window, '2026-09-25');
    expect(freeBusyCalls).toEqual([['a@cutest.co.jp']]);
    expect(result.syncedStaffCount).toBe(1);
    expect(ctx.appLog.byAction('calendar.staff_calendar_not_allowed')).toEqual([
      expect.objectContaining({ level: 'WARN', targetStaffId: b, details: { source: 'busy_blocks' } }),
    ]);
  });

  it('全テナント分を回し、1テナントの例外で他を止めない', async () => {
    const { ctx, deps } = await setup(
      new Map([
        ['a@cutest.co.jp', { busy: [] }],
        ['b@cutest.co.jp', { busy: [] }],
      ]),
    );
    const results = await syncStaffBusyBlocksForAllTenants(deps, window);
    expect(results.get(ctx.tenantId)).toMatchObject({ syncedStaffCount: 2 });
  });
});
