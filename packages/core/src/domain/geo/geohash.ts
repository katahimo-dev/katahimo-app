/**
 * 位置の粗い区画(geohash)。正確な緯度経度は暗号化して保存し(*_geo_enc)、移動時間のキャッシュや
 * 担当エリアの事前絞り込みに使う粗い区画だけを平文で持つ(*_geo_cell)。6文字でおよそ 1.2km × 0.6km。
 */
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

/** 'lat,lng' の文字列から区画を求める。読めなければnull。 */
export function geoCellOf(latLng: string | null | undefined): string | null {
  if (!latLng) return null;
  const [lat, lng] = latLng.split(',').map((v) => Number(v.trim()));
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return encodeGeohash(lat, lng);
}
