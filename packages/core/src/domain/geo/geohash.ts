/**
 * 緯度経度(customer_addresses.lat / lng、staff.home_lat / home_lng)と、移動時間のキャッシュや担当エリアの
 * 事前絞り込みに使う粗い区画(geohash。*_geo_cell)。6文字でおよそ 1.2km × 0.6km。
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export const GEO_CELL_PRECISION = 6;

export function encodeGeohash(lat: number, lng: number, precision: number = GEO_CELL_PRECISION): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = '';
  let bit = 0;
  let value = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        value = (value << 1) | 1;
        lngMin = mid;
      } else {
        value <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        value = (value << 1) | 1;
        latMin = mid;
      } else {
        value <<= 1;
        latMax = mid;
      }
    }
    even = !even;
    if (++bit === 5) {
      hash += BASE32[value];
      bit = 0;
      value = 0;
    }
  }
  return hash;
}

/** 緯度経度の区画。無ければ null。 */
export function geoCellOf(point: GeoPoint | null): string | null {
  return point ? encodeGeohash(point.lat, point.lng) : null;
}
