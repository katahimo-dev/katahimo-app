import { describe, expect, it } from 'vitest';
import { addIsoDays, extractPrefecture, formatBirthDate, toIsoDate } from './dates';

describe('顧客の日付', () => {
  it('YYYY/M/D と YYYY-MM-DD を行き来し、実在しない日付は null', () => {
    expect(toIsoDate('2019/1/19')).toBe('2019-01-19');
    expect(toIsoDate('2019/02/30')).toBeNull();
    expect(toIsoDate('令和1年')).toBeNull();
    expect(formatBirthDate('2019-01-19')).toBe('2019/1/19');
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('都道府県を取り出す', () => {
    expect(extractPrefecture('東京都世田谷区用賀4-1-1')).toBe('東京都');
    expect(extractPrefecture('神奈川県横浜市')).toBe('神奈川県');
    expect(extractPrefecture('世田谷区')).toBeNull();
  });
});
