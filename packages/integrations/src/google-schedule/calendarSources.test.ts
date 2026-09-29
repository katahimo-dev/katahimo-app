import type { ScheduleStaff } from '@katahimo/core/ports';
import { describe, expect, it } from 'vitest';
import { resolveCalendarSources, selectViewCalendarSources } from './calendarSources';

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

describe('selectViewCalendarSources', () => {
  const staff = (id: string, name: string, calendarId: string | null): ScheduleStaff => ({
    id,
    name,
    calendarId,
    home: { address: '', latLng: null },
    travelMode: 'car',
  });
  const settings = {
    sharedCalendars: [
      { calendarId: 'reserva@group.calendar.google.com', ownerName: '山田 太郎' },
      { calendarId: 'events@group.calendar.google.com' },
    ],
    allowedStaffCalendars: ['@cutest.biz'],
  };
  const sato = staff('s1', '佐藤 美咲', 'sato@cutest.biz');
  const takahashi = staff('s2', '高橋 由美', 'takahashi@cutest.biz');

  it('他のスタッフの予定のカレンダーだけを除き、共有カレンダーは持ち主名にかかわらず全部残す', () => {
    const { sources } = resolveCalendarSources(settings, [sato, takahashi]);
    expect(selectViewCalendarSources(sources, sato).map((s) => s.calendarId)).toEqual([
      'sato@cutest.biz',
      'reserva@group.calendar.google.com',
      'events@group.calendar.google.com',
    ]);
    expect(selectViewCalendarSources(sources, takahashi).map((s) => s.calendarId)).toEqual([
      'takahashi@cutest.biz',
      'reserva@group.calendar.google.com',
      'events@group.calendar.google.com',
    ]);
  });

  it('同じカレンダーを複数のスタッフが設定していれば、どちらを見ても読む(持ち主は全体と同じく先のスタッフ)', () => {
    const second = staff('s3', '鈴木 花', ' SATO@cutest.biz ');
    const { sources } = resolveCalendarSources(settings, [sato, takahashi, second]);
    expect(selectViewCalendarSources(sources, second)).toEqual([
      { calendarId: 'sato@cutest.biz', ownerName: '佐藤 美咲', staffId: 's1' },
      { calendarId: 'reserva@group.calendar.google.com', ownerName: '山田 太郎' },
      { calendarId: 'events@group.calendar.google.com' },
    ]);
  });

  it('予定のカレンダーが無いスタッフは共有カレンダーだけ。同姓同名の他のスタッフのカレンダーも読まない', () => {
    const noCalendar = staff('s4', '佐藤 美咲', null);
    const { sources } = resolveCalendarSources(settings, [sato, noCalendar]);
    expect(selectViewCalendarSources(sources, noCalendar).map((s) => s.calendarId)).toEqual([
      'reserva@group.calendar.google.com',
      'events@group.calendar.google.com',
    ]);
  });
});
