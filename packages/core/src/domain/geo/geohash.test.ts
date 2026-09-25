import { describe, expect, it } from 'vitest';
import { encodeGeohash, geoCellOf } from './geohash';

describe('geohash', () => {
  it('既知の値と一致する', () => {
    // 東京駅付近
    expect(encodeGeohash(35.681236, 139.767125, 7)).toBe('xn76urx');
    expect(geoCellOf('35.681236, 139.767125')).toBe('xn76ur');
  });
  it('読めない値はnull', () => {
    expect(geoCellOf('')).toBeNull();
    expect(geoCellOf('abc')).toBeNull();
    expect(geoCellOf('100,200')).toBeNull();
  });
});
