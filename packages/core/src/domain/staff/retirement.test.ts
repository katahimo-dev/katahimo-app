import { describe, expect, it } from 'vitest';
import { isRetiredOn, jstBusinessDate, normalizeRetirementDate } from './retirement';

describe('jstBusinessDate', () => {
  it('UTCでは前日でも、JSTで日付が変わっていればJSTの日付を返す', () => {
    // 2026-09-30T15:30Z = JST 2026-10-01 00:30
    expect(jstBusinessDate(new Date('2026-09-30T15:30:00Z'))).toBe('2026-10-01');
    expect(jstBusinessDate(new Date('2026-09-30T14:59:59Z'))).toBe('2026-09-30');
  });
});

describe('isRetiredOn', () => {
  it('退職日の当日以降は退職済み、前日までは在籍', () => {
    expect(isRetiredOn('2026-10-01', '2026-09-30')).toBe(false);
    expect(isRetiredOn('2026-10-01', '2026-10-01')).toBe(true);
    expect(isRetiredOn('2026-10-01', '2026-10-02')).toBe(true);
  });

  it('退職日が未設定なら在籍', () => {
    expect(isRetiredOn(null, '2026-10-01')).toBe(false);
  });

  it('JSTの0〜9時(UTCでは前日)でも退職日当日なら退職済み(new Date(YYYY-MM-DD)のUTC解釈によるずれが無い)', () => {
    const jstEarlyMorning = new Date('2026-09-30T16:00:00Z'); // JST 2026-10-01 01:00
    expect(isRetiredOn('2026-10-01', jstBusinessDate(jstEarlyMorning))).toBe(true);
  });
});

describe('normalizeRetirementDate', () => {
  it.each([
    ['2026/3/31', '2026-03-31'],
    ['2026-03-31', '2026-03-31'],
    ['2026/03/31 0:00:00', '2026-03-31'],
    ['2026年3月31日', '2026-03-31'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRetirementDate(input)).toBe(expected);
  });

  it.each(['', '未定', '2026/2/30', '2026/13/1'])('解釈できない値(%s)はnull', (input) => {
    expect(normalizeRetirementDate(input)).toBeNull();
  });
});
