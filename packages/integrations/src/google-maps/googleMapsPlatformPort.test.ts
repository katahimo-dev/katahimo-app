import { describe, expect, it } from 'vitest';
import { GoogleMapsPlatformPort } from './googleMapsPlatformPort';

interface Captured {
  url: string;
  init?: RequestInit;
}

function fakeFetch(status: number, body: unknown, captured: Captured[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const origin = { lat: 35.6264, lng: 139.6336 };
const destination = { lat: 35.6437, lng: 139.6708 };

describe('GoogleMapsPlatformPort.geocode (Geocoding API)', () => {
  it('最初の候補の緯度経度を返す', async () => {
    const captured: Captured[] = [];
    const maps = new GoogleMapsPlatformPort({
      apiKey: 'test-key',
      fetch: fakeFetch(
        200,
        {
          status: 'OK',
          results: [
            {
              formatted_address: '日本、〒154-0024 東京都世田谷区三軒茶屋１丁目２−３',
              geometry: { location: { lat: 35.6437, lng: 139.6708 }, location_type: 'ROOFTOP' },
              place_id: 'ChIJxxxx',
            },
            { geometry: { location: { lat: 1, lng: 2 } } },
          ],
        },
        captured,
      ),
    });
    expect(await maps.geocode('東京都世田谷区三軒茶屋1-2-3')).toEqual({ lat: 35.6437, lng: 139.6708 });
    const url = new URL(captured[0]?.url ?? '');
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/geocode/json');
    expect(url.searchParams.get('address')).toBe('東京都世田谷区三軒茶屋1-2-3');
    expect(url.searchParams.get('key')).toBe('test-key');
  });

  it('ZERO_RESULTS は null、それ以外のエラーは例外', async () => {
    const zero = new GoogleMapsPlatformPort({
      apiKey: 'k',
      fetch: fakeFetch(200, { status: 'ZERO_RESULTS', results: [] }, []),
    });
    expect(await zero.geocode('存在しない住所')).toBeNull();

    const denied = new GoogleMapsPlatformPort({
      apiKey: 'k',
      fetch: fakeFetch(
        200,
        { status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.', results: [] },
        [],
      ),
    });
    await expect(denied.geocode('東京')).rejects.toThrow(
      'Geocoding API エラー: REQUEST_DENIED (The provided API key is invalid.)',
    );
  });
});

describe('GoogleMapsPlatformPort.route (Routes API computeRoutes)', () => {
  it('自動車は TRAFFIC_UNAWARE で要求し、距離(m)・所要時間(秒)を返す', async () => {
    const captured: Captured[] = [];
    const maps = new GoogleMapsPlatformPort({
      apiKey: 'test-key',
      fetch: fakeFetch(200, { routes: [{ distanceMeters: 5438, duration: '731s' }] }, captured),
    });
    expect(await maps.route(origin, destination)).toEqual({ distanceMeters: 5438, durationSeconds: 731 });

    const request = captured[0];
    expect(request?.url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = new Headers(request?.init?.headers);
    expect(headers.get('X-Goog-Api-Key')).toBe('test-key');
    expect(headers.get('X-Goog-FieldMask')).toBe('routes.distanceMeters,routes.duration');
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      origin: { location: { latLng: { latitude: 35.6264, longitude: 139.6336 } } },
      destination: { location: { latLng: { latitude: 35.6437, longitude: 139.6708 } } },
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'METRIC',
    });
  });

  it.each([
    ['bicycle', 'BICYCLE'],
    ['transit', 'TRANSIT'],
    ['walk', 'WALK'],
  ] as const)('移動手段 %s は travelMode=%s(routingPreferenceは付けない)', async (mode, apiMode) => {
    const captured: Captured[] = [];
    const maps = new GoogleMapsPlatformPort({
      apiKey: 'k',
      fetch: fakeFetch(200, { routes: [{ distanceMeters: 10, duration: '5s' }] }, captured),
    });
    await maps.route(origin, destination, { travelMode: mode });
    const body = JSON.parse(String(captured[0]?.init?.body));
    expect(body.travelMode).toBe(apiMode);
    expect(body).not.toHaveProperty('routingPreference');
  });

  it('同じ地点など値が0の項目は省略されて返るため0として扱う。経路が無ければ null', async () => {
    const same = new GoogleMapsPlatformPort({
      apiKey: 'k',
      fetch: fakeFetch(200, { routes: [{ duration: '0s' }] }, []),
    });
    expect(await same.route(origin, origin)).toEqual({ distanceMeters: 0, durationSeconds: 0 });
    const none = new GoogleMapsPlatformPort({ apiKey: 'k', fetch: fakeFetch(200, {}, []) });
    expect(await none.route(origin, destination)).toBeNull();
  });

  it('HTTPエラー(APIの無効化・クォータ超過等)は例外', async () => {
    const maps = new GoogleMapsPlatformPort({
      apiKey: 'k',
      fetch: fakeFetch(
        403,
        {
          error: {
            code: 403,
            message: 'Routes API has not been used in project 123 before or it is disabled.',
            status: 'PERMISSION_DENIED',
          },
        },
        [],
      ),
    });
    await expect(maps.route(origin, destination)).rejects.toThrow(
      'Routes API エラー: HTTP 403 PERMISSION_DENIED',
    );
  });
});
