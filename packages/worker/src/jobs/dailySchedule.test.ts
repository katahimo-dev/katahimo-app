import { describe, expect, it } from 'vitest';
import { nextJstOccurrence } from './dailySchedule';

describe('nextJstOccurrence', () => {
  it('今日のその時刻がまだなら今日、過ぎていれば翌日(JST)', () => {
    // 2026-09-25 21:00 JST
    expect(nextJstOccurrence(new Date('2026-09-25T12:00:00Z'), 22, 0)).toEqual(
      new Date('2026-09-25T13:00:00Z'),
    );
    // 2026-09-25 22:00 JST ちょうど → 翌日
    expect(nextJstOccurrence(new Date('2026-09-25T13:00:00Z'), 22, 0)).toEqual(
      new Date('2026-09-26T13:00:00Z'),
    );
    // 2026-09-25 23:30 JST → 翌日 03:00 JST
    expect(nextJstOccurrence(new Date('2026-09-25T14:30:00Z'), 3, 0)).toEqual(
      new Date('2026-09-25T18:00:00Z'),
    );
  });
});
