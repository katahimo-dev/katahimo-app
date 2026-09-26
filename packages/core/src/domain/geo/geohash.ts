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

/** 取込元の 'lat,lng' の文字列を読む(数でない・範囲外なら null)。 */
export function parseGeoPoint(latLng: string | null | undefined): GeoPoint | null {
  if (!latLng) return null;
  const [lat, lng] = latLng.split(',').map((v) => Number(v.trim()));
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** 画面に出す 'lat,lng'(取込元の CSV と同じ形)。 */
export function formatGeoPoint(point: GeoPoint): string {
  return `${point.lat},${point.lng}`;
}

/** 緯度経度の区画。無ければ null。 */
export function geoCellOf(point: GeoPoint | null): string | null {
  return point ? encodeGeohash(point.lat, point.lng) : null;
}
