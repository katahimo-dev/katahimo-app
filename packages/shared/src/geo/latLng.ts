/** 緯度経度(度)。 */
export interface LatLngValue {
  lat: number;
  lng: number;
}

/** 区切り: 半角・全角のカンマ。カンマが無いときは空白。 */
const COMMA = /[,，]/;

/**
 * 顧客CSVの「緯度・経度」の表記(例 '35.6810, 139.7670')を読む。サーバーの取込と画面の地図ボタンで同じ規則を使う。
 *
 * GAS版 RouteSearch.js と同じく、区切った緯度・経度をそれぞれ parseFloat で読む(先頭の数だけを読み、
 * '35.68°' は 35.68)。区切りは半角・全角のカンマ、カンマが無ければ空白。緯度・経度のどちらかが空・
 * 数で始まらない・範囲外(緯度 ±90、経度 ±180 を超える)なら null。
 */
export function parseLatLngText(value: string | null | undefined): LatLngValue | null {
  const text = value?.trim();
  if (!text) return null;
  const [latText, lngText] = COMMA.test(text) ? text.split(COMMA) : text.split(/\s+/);
  const lat = parseCoordinate(latText);
  const lng = parseCoordinate(lngText);
  if (lat === null || lng === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function parseCoordinate(part: string | undefined): number | null {
  if (!part?.trim()) return null;
  const n = Number.parseFloat(part);
  return Number.isFinite(n) ? n : null;
}
