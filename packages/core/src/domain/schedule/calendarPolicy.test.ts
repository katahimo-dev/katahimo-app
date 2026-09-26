import { describe, expect, it } from 'vitest';
import {
  isStaffCalendarAllowed,
  parseCalendarAllowRule,
  parseSharedCalendar,
  parseTenantCalendarSettings,
} from './calendarPolicy';

describe('スタッフのカレンダーの許可', () => {
  it('完全一致のIDと、ドメインの後方一致(@ から)で許可する。大文字・前後の空白は区別しない', () => {
    const settings = { sharedCalendars: [], allowedStaffCalendars: ['@cutest.co.jp', 'yamada@gmail.com'] };
    expect(isStaffCalendarAllowed(settings, ' Sato@Cutest.co.jp ')).toBe(true);
    expect(isStaffCalendarAllowed(settings, 'yamada@gmail.com')).toBe(true);
    expect(isStaffCalendarAllowed(settings, 'other@gmail.com')).toBe(false);
    expect(isStaffCalendarAllowed(settings, 'sato@evil-cutest.co.jp')).toBe(false);
    expect(isStaffCalendarAllowed(settings, 'sato@sub.cutest.co.jp')).toBe(false);
    expect(isStaffCalendarAllowed({ sharedCalendars: [], allowedStaffCalendars: [] }, 'a@cutest.co.jp')).toBe(
      false,
    );
  });

  it('誰でも作れるドメインは後方一致の規則にできない(完全一致のIDなら登録できる)', () => {
    for (const rule of [
      '@gmail.com',
      '@googlemail.com',
      '@group.calendar.google.com',
      '@resource.calendar.google.com',
      '@x.group.calendar.google.com',
    ]) {
      expect(parseCalendarAllowRule(rule).ok).toBe(false);
    }
    expect(parseCalendarAllowRule('abc123@group.calendar.google.com')).toEqual({
      ok: true,
      rule: 'abc123@group.calendar.google.com',
    });
    expect(parseCalendarAllowRule(' @Cutest.co.jp ')).toEqual({ ok: true, rule: '@cutest.co.jp' });
    expect(parseCalendarAllowRule('no-at-mark').ok).toBe(false);
    expect(parseCalendarAllowRule('@nodot').ok).toBe(false);
  });

  it('共有カレンダーは `ID=持ち主名` で持ち主を指定できる', () => {
    expect(parseSharedCalendar('Reserva@group.calendar.google.com=山田 花子')).toEqual({
      ok: true,
      source: { calendarId: 'reserva@group.calendar.google.com', ownerName: '山田 花子' },
    });
    expect(parseSharedCalendar('x@y').ok).toBe(false);
  });

  it('DB の値は読むときにも確かめ、形の崩れた要素・使えない規則は捨てる', () => {
    expect(
      parseTenantCalendarSettings({
        sharedCalendars: [
          { calendarId: 'r@group.calendar.google.com', ownerName: ' ' },
          { calendarId: 1 },
          'x',
        ],
        allowedStaffCalendars: ['@gmail.com', '@cutest.co.jp', 3],
      }),
    ).toEqual({
      sharedCalendars: [{ calendarId: 'r@group.calendar.google.com' }],
      allowedStaffCalendars: ['@cutest.co.jp'],
    });
    expect(parseTenantCalendarSettings(null)).toEqual({ sharedCalendars: [], allowedStaffCalendars: [] });
  });
});
