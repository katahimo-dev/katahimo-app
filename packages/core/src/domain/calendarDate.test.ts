import { describe, expect, it } from 'vitest';
import {
  addDays,
  countDaysInclusive,
  datesOfMonth,
  isValidBusinessDate,
  isValidYearMonth,
  jstBusinessDate,
  jstMonthInstantRange,
  lastDayOfMonth,
} from './calendarDate';

describe('calendarDate', () => {
  it('JSTの暦日はUTC15時で切り替わる', () => {
    expect(jstBusinessDate(new Date('2026-09-25T14:59:59Z'))).toBe('2026-09-25');
    expect(jstBusinessDate(new Date('2026-09-25T15:00:00Z'))).toBe('2026-09-26');
  });

  it('月末・うるう年・月の全日', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(datesOfMonth('2026-09')).toHaveLength(30);
    expect(datesOfMonth('2026-09')[0]).toBe('2026-09-01');
  });

  it('日付の妥当性・日数計算', () => {
    expect(isValidBusinessDate('2026-02-30')).toBe(false);
    expect(isValidBusinessDate('2026-02-28')).toBe(true);
    expect(isValidYearMonth('2026-13')).toBe(false);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(countDaysInclusive('2026-09-01', '2026-09-07')).toBe(7);
  });

  it('JSTの月の範囲(timestamptz検索用)', () => {
    expect(jstMonthInstantRange('2026-09')).toEqual({
      from: new Date('2026-08-31T15:00:00Z'),
      to: new Date('2026-09-30T15:00:00Z'),
    });
  });
});
