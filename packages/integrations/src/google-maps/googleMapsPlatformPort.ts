import type { LatLng, MapsPort, RouteLeg, RouteOptions, TravelMode } from '@katahimo/core/ports';
import { DEFAULT_TRAVEL_MODE } from '@katahimo/core/ports';

export interface GoogleMapsPlatformOptions {
  /** Geocoding API と Routes API を有効にしたAPIキー。 */
  apiKey: string;
  /** テスト用の差し替え口。 */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const COMPUTE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

const ROUTES_TRAVEL_MODE: Record<TravelMode, string> = {
  car: 'DRIVE',
  bicycle: 'BICYCLE',
  transit: 'TRANSIT',
  walk: 'WALK',
};

interface GeocodeResponse {
  status: string;
  error_message?: string;
  results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
}

interface ComputeRoutesResponse {
  routes?: Array<{ distanceMeters?: number; duration?: string }>;
  error?: { message?: string; status?: string };
}

/**
 * Google Maps Platform を直接呼ぶ MapsPort 実装(Geocoding API + Routes API computeRoutes)。
 *
 * GAS版 Maps.newGeocoder().geocode() / Maps.newDirectionFinder()(DRIVING・出発時刻指定なし)の
 * 置き換え。レガシーのDirections APIは新規GCPプロジェクトで有効化できないためRoutes APIを使う。
 * 交通状況を考慮しない(TRAFFIC_UNAWARE)のはGAS版と同じ結果・最安の料金区分にするため。
 */
export class GoogleMapsPlatformPort implements MapsPort {
  private readonly fetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: GoogleMapsPlatformOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async geocode(address: string): Promise<LatLng | null> {
    const url = new URL(GEOCODE_URL);
    url.searchParams.set('address', address);
    url.searchParams.set('key', this.options.apiKey);
    const res = await this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    const body = (await res.json()) as GeocodeResponse;

    if (body.status === 'ZERO_RESULTS') return null;
    if (body.status !== 'OK') {
      throw new Error(
        `Geocoding API エラー: ${body.status}${body.error_message ? ` (${body.error_message})` : ''}`,
      );
    }
    const location = body.results?.[0]?.geometry?.location;
    return location ? { lat: location.lat, lng: location.lng } : null;
  }

  async route(origin: LatLng, destination: LatLng, options?: RouteOptions): Promise<RouteLeg | null> {
    const travelMode = options?.travelMode ?? DEFAULT_TRAVEL_MODE;
    const res = await this.fetch(COMPUTE_ROUTES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.options.apiKey,
        // 必要な項目だけを要求する(FieldMaskで課金区分と応答サイズが決まる)。
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration',
      },
      body: JSON.stringify({
        origin: toWaypoint(origin),
        destination: toWaypoint(destination),
        travelMode: ROUTES_TRAVEL_MODE[travelMode],
        // routingPreference は自動車(DRIVE/TWO_WHEELER)でのみ指定できる。
        ...(travelMode === 'car' ? { routingPreference: 'TRAFFIC_UNAWARE' } : {}),
        units: 'METRIC',
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = (await res.json()) as ComputeRoutesResponse;
    if (!res.ok) {
      throw new Error(
        `Routes API エラー: HTTP ${res.status} ${body.error?.status ?? ''} ${body.error?.message ?? ''}`.trim(),
      );
    }

    const route = body.routes?.[0];
    if (!route) return null;
    // proto3のJSONでは0の値は省略されるため、欠けている値は0として扱う。
    return {
      distanceMeters: route.distanceMeters ?? 0,
      durationSeconds: parseDurationSeconds(route.duration),
    };
  }
}

function toWaypoint({ lat, lng }: LatLng) {
  return { location: { latLng: { latitude: lat, longitude: lng } } };
}

/** Routes APIの Duration('1234s' / '12.5s')を秒に変換する。 */
function parseDurationSeconds(duration: string | undefined): number {
  const seconds = Number.parseFloat((duration ?? '0s').replace(/s$/, ''));
  return Number.isFinite(seconds) ? seconds : 0;
}
