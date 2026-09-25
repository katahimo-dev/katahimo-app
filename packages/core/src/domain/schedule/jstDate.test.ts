import { describe, expect, it } from 'vitest';
import { formatJstTime, isValidBusinessDate, jstDayRange, jstMidnight, jstToday } from './jstDate';

describe('JSTの日付境界', () => {
  it('1日はJSTの0:00〜翌0:00(UTCでは前日15:00〜当日15:00)', () => {
    const range = jstDayRange('2026-09-25');
    expect(range.from.toISOString()).toBe('2026-09-24T15:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-09-25T15:00:00.000Z');
  });

  it('月末・年末をまたいでも24時間', () => {
    const range = jstDayRange('2026-12-31');
    expect(range.to.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(jstMidnight('2027-01-01').toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('実在しない日付・書式違いは不正', () => {
    expect(isValidBusinessDate('2026-09-25')).toBe(true);
    expect(isValidBusinessDate('2028-02-29')).toBe(true);
    expect(isValidBusinessDate('2026-02-29')).toBe(false);
    expect(isValidBusinessDate('2026-9-25')).toBe(false);
    expect(isValidBusinessDate('2026/09/25')).toBe(false);
    expect(() => jstDayRange('2026-13-01')).toThrow();
  });

  it("'HH:mm' はサーバーのタイムゾーンに関係なくJSTで表示する", () => {
    expect(formatJstTime(new Date('2026-09-25T00:30:00Z'))).toBe('09:30');
    expect(formatJstTime(new Date('2026-09-25T15:00:00Z'))).toBe('00:00');
    expect(formatJstTime(new Date('2026-09-25T14:59:00Z'))).toBe('23:59');
  });

  it('今日の日付はJSTで決まる(UTC 15:00 以降は翌日)', () => {
    expect(jstToday(new Date('2026-09-25T14:59:59Z'))).toBe('2026-09-25');
    expect(jstToday(new Date('2026-09-25T15:00:00Z'))).toBe('2026-09-26');
  });
});
