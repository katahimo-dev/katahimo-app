import { describe, expect, it } from 'vitest';
import { encodeGeohash, formatGeoPoint, geoCellOf, parseGeoPoint } from './geohash';

describe('geohash', () => {
  it('既知の値と一致する', () => {
    // 東京駅付近
    expect(encodeGeohash(35.681236, 139.767125, 7)).toBe('xn76urx');
    expect(geoCellOf(parseGeoPoint('35.681236, 139.767125'))).toBe('xn76ur');
    expect(geoCellOf(null)).toBeNull();
  });
  it('緯度経度の文字列を読む(読めない値・範囲外は null)', () => {
    expect(parseGeoPoint('35.681236, 139.767125')).toEqual({ lat: 35.681236, lng: 139.767125 });
    expect(parseGeoPoint('')).toBeNull();
    expect(parseGeoPoint(null)).toBeNull();
    expect(parseGeoPoint('abc')).toBeNull();
    expect(parseGeoPoint('100,200')).toBeNull();
  });
  it('画面には lat,lng の形で出す', () => {
    expect(formatGeoPoint({ lat: 35.6315, lng: 139.6446 })).toBe('35.6315,139.6446');
  });
});
