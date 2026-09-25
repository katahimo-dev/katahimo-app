import { describe, expect, it } from 'vitest';
import { minutesSinceZonedMidnight, zonedBusinessDate, zonedDayRange, zonedInstant } from './zoned';

describe('テナントのタイムゾーンの変換', () => {
  it('Asia/Tokyo の壁時計時刻を絶対時刻にする', () => {
    expect(zonedInstant('2026-09-25', 10 * 60, 'Asia/Tokyo').toISOString()).toBe('2026-09-25T01:00:00.000Z');
    expect(zonedDayRange('2026-09-25', 'Asia/Tokyo')).toEqual({
      from: new Date('2026-09-24T15:00:00Z'),
      to: new Date('2026-09-25T15:00:00Z'),
    });
    expect(zonedBusinessDate(new Date('2026-09-24T15:00:00Z'), 'Asia/Tokyo')).toBe('2026-09-25');
  });
  it('夏時間のあるタイムゾーンでも日付の境界が合う', () => {
    // 2026-03-08 は米国の夏時間開始日(23時間の日)
    const { from, to } = zonedDayRange('2026-03-08', 'America/New_York');
    expect((to.getTime() - from.getTime()) / 3_600_000).toBe(23);
    expect(zonedInstant('2026-07-01', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
  });
  it('業務日の0:00からの分(翌日は1440以上)', () => {
    const at = new Date('2026-09-25T16:30:00Z');
    expect(minutesSinceZonedMidnight(at, '2026-09-25', 'Asia/Tokyo')).toBe(25 * 60 + 30);
  });
});
