import type { ScheduleStaff } from '@katahimo/core/ports';
import { describe, expect, it } from 'vitest';
import { resolveCalendarSources } from './calendarSources';

describe('resolveCalendarSources', () => {
  const staff = (id: string, name: string, calendarId: string | null): ScheduleStaff => ({
    id,
    name,
    calendarId,
    home: { address: '', latLng: null },
    travelMode: 'car',
  });

  it('スタッフのカレンダー(持ち主=そのスタッフ)を先に、テナントの共有カレンダーを後に、同じIDは1回だけ', () => {
    expect(
      resolveCalendarSources(
        {
          sharedCalendars: [
            { calendarId: 'reserva@group.calendar.google.com' },
            { calendarId: 'sato@cutest.biz', ownerName: '別名' },
          ],
          allowedStaffCalendars: ['@cutest.biz'],
        },
        [
          staff('s1', '佐藤 美咲', ' Sato@cutest.biz '),
          staff('s2', '高橋 由美', null),
          staff('s3', '重複', 'sato@cutest.biz'),
        ],
      ),
    ).toEqual({
      sources: [
        { calendarId: 'sato@cutest.biz', ownerName: '佐藤 美咲', staffId: 's1' },
        { calendarId: 'reserva@group.calendar.google.com' },
      ],
      disallowedStaffIds: [],
    });
  });

  it('許可の一覧に合わないスタッフのカレンダーは読まない(許可を後から外した場合も)', () => {
    const result = resolveCalendarSources(
      { sharedCalendars: [], allowedStaffCalendars: ['ok@example.com'] },
      [staff('s1', 'A', 'ok@example.com'), staff('s2', 'B', 'other-tenant@example.org')],
    );
    expect(result.sources.map((s) => s.calendarId)).toEqual(['ok@example.com']);
    expect(result.disallowedStaffIds).toEqual(['s2']);
  });
});
