import { describe, expect, it } from 'vitest';
import { scheduleAppointmentWithRouteSchema } from './schedule';

describe('予定の区間の道順の URL', () => {
  it('Google マップの https の URL だけを残し、それ以外(別のサイト・javascript: 等)は空にする', () => {
    const parse = (url: string) =>
      scheduleAppointmentWithRouteSchema.parse({ moveUrl: url, attendanceUrl: url, leavingUrl: url });
    const ok =
      'https://www.google.com/maps/dir/?api=1&origin=35.1,139.1&destination=35.2,139.2&travelmode=driving';
    expect(parse(ok)).toMatchObject({ moveUrl: ok, attendanceUrl: ok, leavingUrl: ok });
    for (const bad of [
      'javascript:alert(1)',
      'https://evil.example/maps/',
      'https://www.google.com.evil.example/maps/',
      'http://www.google.com/maps/dir/',
      'https://www.google.com/mapsx',
    ]) {
      expect(parse(bad)).toMatchObject({ moveUrl: '', attendanceUrl: '', leavingUrl: '' });
    }
  });
});
