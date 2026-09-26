import { describe, expect, it } from 'vitest';
import { encodeGeohash, geoCellOf } from './geohash';

describe('geohash', () => {
  it('既知の値と一致する', () => {
    // 東京駅付近
    expect(encodeGeohash(35.681236, 139.767125, 7)).toBe('xn76urx');
    expect(geoCellOf({ lat: 35.681236, lng: 139.767125 })).toBe('xn76ur');
    expect(geoCellOf(null)).toBeNull();
  });
});
