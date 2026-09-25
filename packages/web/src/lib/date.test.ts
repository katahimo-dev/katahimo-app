import { describe, expect, it } from 'vitest';
import { addDaysYmd, jstDateString, jstHHmm, jstParts, todayJst, weekdayOfYmd } from './date';

describe('lib/date(業務日は日本時間)', () => {
  it('端末の時刻帯に関係なく、日本時間の日付・時刻を返す', () => {
    // 2026-09-24 15:30 UTC = 2026-09-25 00:30 JST
    const at = Date.parse('2026-09-24T15:30:00Z');
    expect(jstDateString(at)).toBe('2026-09-25');
    expect(todayJst(new Date(at))).toBe('2026-09-25');
    expect(jstHHmm(at)).toBe('00:30');
    expect(jstParts(at)).toEqual({ year: 2026, month: 9, day: 25, hour: 0, minute: 30, weekday: 5 });
  });

  it('月・年をまたいで日付を動かせる', () => {
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('曜日(0 = 日曜)', () => {
    expect(weekdayOfYmd('2026-09-25')).toBe(5);
    expect(weekdayOfYmd('2026-09-27')).toBe(0);
  });
});
