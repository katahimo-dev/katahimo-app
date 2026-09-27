import { describe, expect, it } from 'vitest';
import {
  formatLegacyWallClock,
  legacyTimeOfDay,
  legacyWallClockDate,
  legacyWallClockFromSerial,
  legacyWallClockToInstant,
  parseLegacyWallClockText,
} from './wallClock';

const text = (value: string) => {
  const wall = parseLegacyWallClockText(value);
  return wall ? formatLegacyWallClock(wall) : null;
};

describe('GAS版のシートの日時・時刻の読み方', () => {
  it('日時の文字列は表記の揺れを揃えて yyyy/MM/dd HH:mm:ss にする', () => {
    expect(text('2026/09/05 09:00:00')).toBe('2026/09/05 09:00:00');
    expect(text(' 2026/9/5 9:05 ')).toBe('2026/09/05 09:05:00');
    expect(text('2026-09-05T09:05:30')).toBe('2026/09/05 09:05:30');
    expect(text('2026年9月5日 9時5分')).toBe('2026/09/05 09:05:00');
    expect(text('2026/09/05')).toBe('2026/09/05 00:00:00');
  });

  it('読めない・存在しない日時・記録の年の外は null', () => {
    expect(text('')).toBeNull();
    expect(text('昨日')).toBeNull();
    expect(text('2026/02/30 10:00')).toBeNull();
    expect(text('2026/09/05 24:00')).toBeNull();
    expect(text('1999/12/31 10:00')).toBeNull();
  });

  it('シリアル値(1899-12-30 からの日数)は壁時計時刻にする(秒に丸める)', () => {
    // 2026/09/05 09:00:00 = 46270 日 + 0.375
    const serial = (Date.UTC(2026, 8, 5) - Date.UTC(1899, 11, 30)) / 86_400_000 + 0.375;
    expect(formatLegacyWallClock(legacyWallClockFromSerial(serial) ?? fail())).toBe('2026/09/05 09:00:00');
    expect(formatLegacyWallClock(legacyWallClockFromSerial(serial + 0.4 / 86_400) ?? fail())).toBe(
      '2026/09/05 09:00:00',
    );
    expect(legacyWallClockFromSerial(0.5)).toBeNull();
    expect(legacyWallClockFromSerial(Number.NaN)).toBeNull();
  });

  it('時刻のセルは HH:mm にする(シリアル値は時刻の部分だけ)', () => {
    expect(legacyTimeOfDay(0.375)).toBe('09:00');
    expect(legacyTimeOfDay(46270.5625)).toBe('13:30');
    expect(legacyTimeOfDay('9:05')).toBe('09:05');
    expect(legacyTimeOfDay('09:05:59')).toBe('09:05');
    expect(legacyTimeOfDay('９：05')).toBeNull();
    expect(legacyTimeOfDay('25:00')).toBeNull();
    expect(legacyTimeOfDay('午後')).toBeNull();
  });

  it('壁時計時刻をテナントのタイムゾーンで絶対時刻にする', () => {
    expect(legacyWallClockToInstant('2026/09/05 09:00:30', 'Asia/Tokyo').toISOString()).toBe(
      '2026-09-05T00:00:30.000Z',
    );
    expect(legacyWallClockToInstant('2026/09/05 09:00:00', 'UTC').toISOString()).toBe(
      '2026-09-05T09:00:00.000Z',
    );
    expect(legacyWallClockDate('2026/09/05 09:00:00')).toBe('2026-09-05');
    expect(() => legacyWallClockToInstant('2026/9/5 9:00', 'Asia/Tokyo')).toThrow();
  });
});

function fail(): never {
  throw new Error('読めませんでした');
}
