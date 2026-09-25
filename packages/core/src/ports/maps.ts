/**
 * 地理計算のポート。
 *
 * GAS版は Maps.newGeocoder() / Maps.newDirectionFinder() (APIキー不要のGAS内蔵サービス)を
 * 使っていたが、サーバー実装では Google Maps Platform の Geocoding API と Routes API になる。
 * 2025年3月以降の新規GCPプロジェクトではレガシーのDirections APIを有効化できないため、
 * 経路計算は Routes API 前提(doc/07 第10.3章)。
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteLeg {
  /** 所要時間(分)。出勤簿の移動時間セルに入る値。 */
  durationMin: number;
  /** 距離(km)。基準距離超過の判定に使うため、丸め方を変えると手当額が変わる。 */
  distanceKm: number;
}

export interface MapsPort {
  geocode(address: string): Promise<LatLng | null>;
  /** 自動車での経路。出発時刻を渡せる場合は渡す(交通状況を考慮するため)。 */
  route(origin: LatLng, destination: LatLng, departureAt?: Date): Promise<RouteLeg | null>;
}
