import { describe, expect, it } from 'vitest';
import { formatJstDateTime, parseJstTimestamp } from './jstTime';

const jst = (value: string) => {
  const date = parseJstTimestamp(value);
  return date ? formatJstDateTime(date) : null;
};

describe('parseJstTimestamp(領収書日時。GAS版のシートが日時として読めた表記)', () => {
  it('正規の表記・1桁の月日時・秒あり', () => {
    expect(jst('2026/09/05 09:05')).toBe('2026/09/05 09:05:00');
    expect(jst('2026/9/5 9:05')).toBe('2026/09/05 09:05:00');
    expect(jst('2026/09/05 21:30:15')).toBe('2026/09/05 21:30:15');
  });

  it('日付だけは 0:00。区切りの -・.・年月日も読む', () => {
    expect(jst('2026/09/05')).toBe('2026/09/05 00:00:00');
    expect(jst('2026-9-5')).toBe('2026/09/05 00:00:00');
    expect(jst('2026.09.05 10:00')).toBe('2026/09/05 10:00:00');
    expect(jst('2026年9月5日 9:05')).toBe('2026/09/05 09:05:00');
    expect(jst('2026年9月5日9時05分')).toBe('2026/09/05 09:05:00');
  });

  it('読めない表記・存在しない日時は null(呼び出し側がフォールバックする)', () => {
    for (const value of [
      '',
      '不明',
      '9/5 9:05',
      '2026/13/01',
      '2026/02/30',
      '2026/09/05 25:00',
      '2026/09/05 9:60',
      // 業務であり得ない年(OCR の読み違い等。2000〜2100年の外)
      '1999/12/31 23:59',
      '2101/01/01',
      '0026/09/05',
    ]) {
      expect(parseJstTimestamp(value)).toBeNull();
    }
    expect(parseJstTimestamp(null)).toBeNull();
    expect(jst('2000/01/01 00:00')).toBe('2000/01/01 00:00:00');
    expect(jst('2100/12/31 23:59')).toBe('2100/12/31 23:59:00');
  });
});
