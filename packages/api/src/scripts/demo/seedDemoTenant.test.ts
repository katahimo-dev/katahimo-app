import { describe, expect, it } from 'vitest';
import { demoRatings, jstInstant, previousMonthDate, thisMonthDate } from './seedDemoTenant';

describe('デモの日報の PSI・ES', () => {
  it('PSI はほとんど 3〜5 で、2 はまれ、1 は作らない', () => {
    const ratings = Array.from({ length: 400 }, (_, i) => demoRatings(`2026-09-${i}`));
    const low = ratings.filter((r) => r.riskRating <= 2).length;
    expect(ratings.every((r) => r.riskRating >= 2 && r.riskRating <= 5)).toBe(true);
    expect(low).toBeLessThan(40);
    expect(ratings.every((r) => r.esRating >= 2 && r.esRating <= 5)).toBe(true);
  });
});

describe('領収書の日付', () => {
  it('今月の分は月の1日より前にならない', () => {
    expect(thisMonthDate('2026-09-28', 3)).toBe('2026-09-25');
    expect(thisMonthDate('2026-10-02', 7)).toBe('2026-10-01');
  });

  it('先月の分は年をまたいでも前の月', () => {
    expect(previousMonthDate('2026-09-28', 10)).toBe('2026-08-10');
    expect(previousMonthDate('2027-01-01', 20)).toBe('2026-12-20');
  });
});

describe('予定の時刻', () => {
  it('業務日と日本時間の時刻から時点を作る', () => {
    expect(jstInstant('2026-09-29', '10:00').toISOString()).toBe('2026-09-29T01:00:00.000Z');
    expect(jstInstant('2026-09-30', '00:30').toISOString()).toBe('2026-09-29T15:30:00.000Z');
  });
});
