/**
 * Googleマップを開くURL(GAS版 index.html の MAPS_BASE_ を使った組み立てと同じ形)。
 * GAS版は配信時の「//」削除を避けるためにスキームを分割していたが、こちらでは不要なので普通に書く。
 */
export const MAPS_BASE = 'https://www.google.com/maps';

/** 住所・緯度経度で地図を検索するURL(GAS版 `MAPS_BASE_ + '/search/?api=1&query=' + …`)。 */
export function mapsSearchUrl(query: string): string {
  return `${MAPS_BASE}/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** 緯度・経度で地図を検索するURL(GAS版は緯度経度をそのまま連結していた)。 */
export function mapsLatLngSearchUrl(lat: number, lng: number): string {
  return `${MAPS_BASE}/search/?api=1&query=${lat},${lng}`;
}

/**
 * 道順のURL(origin/destination の座標入り)から目的地の座標だけを取り出し、出発地を省いた道順のURLを作る。
 * 出発地を省くと、Googleマップは開いた端末の現在地から道順を出す(GAS版 buildCurrentLocationMapsUrl)。
 * 目的地の座標が読み取れないときは ''。
 */
export function currentLocationDirectionsUrl(url: string): string {
  if (!url) return '';
  const m = url.match(/destination=([-0-9.]+),([-0-9.]+)/);
  if (!m) return '';
  return `${MAPS_BASE}/dir/?api=1&destination=${m[1]},${m[2]}&travelmode=driving`;
}
