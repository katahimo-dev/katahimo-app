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

/** 移動手段。値は staff.travel_mode 列と同じ。GAS版は全員 'car'(DRIVING)固定だった。 */
export type TravelMode = 'car' | 'bicycle' | 'transit' | 'walk';

export const DEFAULT_TRAVEL_MODE: TravelMode = 'car';

/** 経路1区間の生の値。分・kmへの丸めはドメイン側(domain/schedule/routeLegs.ts)で行う。 */
export interface RouteLeg {
  durationSeconds: number;
  distanceMeters: number;
}

export interface RouteOptions {
  travelMode?: TravelMode;
}

export interface MapsPort {
  /** 住所が見つからなければnull。通信・認証・クォータ等の失敗は例外。 */
  geocode(address: string): Promise<LatLng | null>;
  /**
   * 経路が見つからなければnull。通信・認証・クォータ等の失敗は例外。
   * 出発時刻は指定しない(GAS版と同じく交通状況を考慮しない経路)。
   */
  route(origin: LatLng, destination: LatLng, options?: RouteOptions): Promise<RouteLeg | null>;
}
