import type { LatLng } from '../../ports/maps';
import type { Place } from './types';

/**
 * 場所が「位置情報あり」か。緯度経度があるか、空白以外の住所があればルート計算の対象になる
 * (移植元: RouteSearch.js calculateDetailedRoutes の hasLocation 判定)。
 * 住所2(期間限定の別住所)はこの判定には使わない(GAS版と同じ)。
 */
export function hasLocation(place: Place): boolean {
  return place.latLng !== null || place.address.trim() !== '';
}

/** ルート計算時に場所をどう特定するか。 */
export type LocationQuery = { kind: 'latLng'; latLng: LatLng } | { kind: 'address'; address: string };

/**
 * 指定日にこの場所を特定する手段を決める(移植元: RouteSearch.js resolveLocation)。
 * - 住所2の適用期間内(両端を含む)なら、登録済みの緯度経度は使わず住所2をジオコーディングする。
 * - それ以外は緯度経度を優先し、無ければ住所をジオコーディングする。
 * - どちらも無ければnull(その区間は算出不可)。
 */
export function locationQueryFor(place: Place, businessDate: string): LocationQuery | null {
  const temporary = place.temporaryAddress;
  if (
    temporary?.address &&
    temporary.startDate &&
    temporary.endDate &&
    temporary.startDate <= businessDate &&
    businessDate <= temporary.endDate
  ) {
    return addressQuery(temporary.address);
  }
  if (place.latLng) return { kind: 'latLng', latLng: place.latLng };
  return addressQuery(place.address);
}

function addressQuery(address: string): LocationQuery | null {
  const trimmed = address.trim();
  return trimmed ? { kind: 'address', address: trimmed } : null;
}

/**
 * 保存した緯度経度(customer_addresses.lat / lng・staff.home_lat / home_lng)をルート計算に使う形にする。
 * 緯度・経度のどちらかが 0 なら緯度経度なし(GAS版 parseLatLng と同じ。住所でジオコーディングする)。
 */
export function routeLatLngOf(point: { lat: number; lng: number } | null): LatLng | null {
  return point && point.lat !== 0 && point.lng !== 0 ? { lat: point.lat, lng: point.lng } : null;
}
