import type { ScheduleStaff } from '@katahimo/core/ports';
import { describe, expect, it } from 'vitest';
import { parseCalendarSourcesEnv, resolveCalendarSources } from './calendarSources';

describe('parseCalendarSourcesEnv', () => {
  it('カンマ区切り。`ID=持ち主名` で持ち主を指定できる', () => {
    expect(
      parseCalendarSourcesEnv(
        ' abc@group.calendar.google.com , yamada@cutest.biz=山田 花子,, =名前だけ, x@y= ',
      ),
    ).toEqual([
      { calendarId: 'abc@group.calendar.google.com' },
      { calendarId: 'yamada@cutest.biz', ownerName: '山田 花子' },
      { calendarId: 'x@y' },
    ]);
    expect(parseCalendarSourcesEnv(undefined)).toEqual([]);
  });
});

describe('resolveCalendarSources', () => {
  const staff = (id: string, name: string, calendarId: string | null): ScheduleStaff => ({
    id,
    name,
    calendarId,
    home: { address: '', latLng: null },
    travelMode: 'car',
  });

  it('staff.calendar_id(持ち主=そのスタッフ)を先に、環境変数のカレンダーを後に、同じIDは1回だけ', () => {
    expect(
      resolveCalendarSources(
        [{ calendarId: 'reserva@group' }, { calendarId: 'sato@cutest.biz', ownerName: '別名' }],
        [
          staff('s1', '佐藤 美咲', ' sato@cutest.biz '),
          staff('s2', '高橋 由美', null),
          staff('s3', '重複', 'sato@cutest.biz'),
        ],
      ),
    ).toEqual([
      { calendarId: 'sato@cutest.biz', ownerName: '佐藤 美咲', staffId: 's1' },
      { calendarId: 'reserva@group' },
    ]);
  });
});
