import type { LatLng, MapsPort, RouteLeg } from '@katahimo/core/ports';
import type { GasBridgeOptions } from './gasBridgeClient';
import { GasBridgeClient } from './gasBridgeClient';

interface BridgeRoute {
  durationMin: number;
  distanceKm: number;
}

/**
 * GAS版Web App(Bridge.js)のMapsサービス(Maps.newGeocoder/newDirectionFinder)をプロキシとして
 * 使う MapsPort 実装。Google Maps PlatformのAPIキーが無い移行期用。
 * Bridge.jsは常に自動車(DRIVING)で計算するため、travelMode の指定は無視される。
 */
export class GasBridgeMapsPort implements MapsPort {
  private readonly client: GasBridgeClient;

  constructor(options: GasBridgeOptions) {
    this.client = new GasBridgeClient(options);
  }

  async geocode(address: string): Promise<LatLng | null> {
    const body = await this.client.fetchJson<{ success: boolean; location: LatLng | null; message?: string }>(
      'geocode',
      { address },
    );
    if (!body.success) throw new Error(body.message || 'ジオコーディングに失敗しました(GASブリッジ)');
    return body.location;
  }

  async route(origin: LatLng, destination: LatLng): Promise<RouteLeg | null> {
    const body = await this.client.fetchJson<{
      success: boolean;
      route: BridgeRoute | null;
      message?: string;
    }>('route', {
      originLat: String(origin.lat),
      originLng: String(origin.lng),
      destLat: String(destination.lat),
      destLng: String(destination.lng),
    });
    if (!body.success) throw new Error(body.message || 'ルート計算に失敗しました(GASブリッジ)');
    // Bridge.jsは分・km(小数2桁)に丸めて返すため、秒・メートルに戻す。
    return body.route
      ? { durationSeconds: body.route.durationMin * 60, distanceMeters: body.route.distanceKm * 1000 }
      : null;
  }
}
