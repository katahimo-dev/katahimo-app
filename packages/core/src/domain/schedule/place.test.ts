import { describe, expect, it } from 'vitest';
import { hasLocation, locationQueryFor, routeLatLngOf } from './place';
import type { Place } from './types';

const tokyo = { lat: 35.6812, lng: 139.7671 };

describe('hasLocation', () => {
  it.each<[string, Place, boolean]>([
    ['緯度経度あり', { address: '', latLng: tokyo }, true],
    ['住所あり', { address: '東京都千代田区丸の内1', latLng: null }, true],
    ['空白だけの住所', { address: ' 　', latLng: null }, false],
    ['何も無い', { address: '', latLng: null }, false],
    [
      '住所2だけ(判定には使わない)',
      {
        address: '',
        latLng: null,
        temporaryAddress: { address: '横浜', startDate: '2026-01-01', endDate: '2026-12-31' },
      },
      false,
    ],
  ])('%s → %s', (_label, place, expected) => {
    expect(hasLocation(place)).toBe(expected);
  });
});

describe('locationQueryFor', () => {
  const withTemporary: Place = {
    address: '東京都目黒区自由が丘2-10-1',
    latLng: tokyo,
    temporaryAddress: {
      address: '神奈川県横浜市青葉区美しが丘1-1',
      startDate: '2026-09-20',
      endDate: '2026-09-30',
    },
  };

  it('住所2の適用期間内(両端を含む)は、登録済みの緯度経度より住所2を優先してジオコーディングする', () => {
    for (const date of ['2026-09-20', '2026-09-25', '2026-09-30']) {
      expect(locationQueryFor(withTemporary, date)).toEqual({
        kind: 'address',
        address: '神奈川県横浜市青葉区美しが丘1-1',
      });
    }
  });

  it('期間外は緯度経度を使う', () => {
    expect(locationQueryFor(withTemporary, '2026-09-19')).toEqual({ kind: 'latLng', latLng: tokyo });
    expect(locationQueryFor(withTemporary, '2026-10-01')).toEqual({ kind: 'latLng', latLng: tokyo });
  });

  it('住所2の期間が片方でも欠けていれば適用しない', () => {
    const place: Place = {
      ...withTemporary,
      temporaryAddress: { address: '横浜', startDate: '2026-09-20', endDate: '' },
    };
    expect(locationQueryFor(place, '2026-09-25')).toEqual({ kind: 'latLng', latLng: tokyo });
  });

  it('緯度経度が無ければ前後の空白を除いた住所をジオコーディングし、住所も無ければ特定不可', () => {
    expect(locationQueryFor({ address: ' 東京都渋谷区 ', latLng: null }, '2026-09-25')).toEqual({
      kind: 'address',
      address: '東京都渋谷区',
    });
    expect(locationQueryFor({ address: '  ', latLng: null }, '2026-09-25')).toBeNull();
  });
});

describe('routeLatLngOf', () => {
  it('保存した緯度経度をそのまま使う', () => {
    expect(routeLatLngOf({ lat: 35.6437, lng: 139.6708 })).toEqual({ lat: 35.6437, lng: 139.6708 });
  });

  it('無い値・0は緯度経度なし', () => {
    expect(routeLatLngOf(null)).toBeNull();
    expect(routeLatLngOf({ lat: 0, lng: 0 })).toBeNull();
    expect(routeLatLngOf({ lat: 35.6437, lng: 0 })).toBeNull();
  });
});
