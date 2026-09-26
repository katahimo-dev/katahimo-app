import { describe, expect, it } from 'vitest';
import { parseLatLngText } from './latLng';

describe('緯度・経度の表記の読み取り(GAS版 parseFloat と同じ)', () => {
  it('半角カンマ・カンマの後の空白・全角カンマ・空白区切りを読む', () => {
    expect(parseLatLngText('35.6810,139.7670')).toEqual({ lat: 35.681, lng: 139.767 });
    expect(parseLatLngText('35.6810, 139.7670')).toEqual({ lat: 35.681, lng: 139.767 });
    expect(parseLatLngText('35.6810，139.7670')).toEqual({ lat: 35.681, lng: 139.767 });
    expect(parseLatLngText(' 35.6810  139.7670 ')).toEqual({ lat: 35.681, lng: 139.767 });
    expect(parseLatLngText('-33.86,151.21')).toEqual({ lat: -33.86, lng: 151.21 });
  });

  it('各部分の先頭の数だけを読む(parseFloat と同じ)', () => {
    expect(parseLatLngText('35.68°,139.76°')).toEqual({ lat: 35.68, lng: 139.76 });
    expect(parseLatLngText('35.68N, 139.76E')).toEqual({ lat: 35.68, lng: 139.76 });
  });

  it('空・片方だけ・数で始まらない・範囲外は null(0 として読まない)', () => {
    for (const value of [
      '',
      '   ',
      ' , ',
      '35.68,',
      ',139.76',
      '35.68',
      'abc',
      'abc,def',
      '100,200',
      null,
      undefined,
    ]) {
      expect(parseLatLngText(value)).toBeNull();
    }
  });
});
