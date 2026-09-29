import type { AppointmentLegPlan } from '@katahimo/core/domain';
import type { LatLng, MapsPort } from '@katahimo/core/ports';
import { describe, expect, it } from 'vitest';
import { InMemoryTtlCache } from '../cache';
import { mapsCacheKey, RouteCalculator } from './routeCalculator';

const HOME = '東京都世田谷区用賀4-1-1';

class CountingMaps implements MapsPort {
  geocodes = 0;
  routes = 0;
  async geocode() {
    this.geocodes++;
    return { lat: 35.62, lng: 139.63 };
  }
  async route(_o: LatLng, _d: LatLng) {
    this.routes++;
    return { durationSeconds: 600, distanceMeters: 3000 };
  }
}

const plan = {
  appointment: {},
  attendance: {
    from: { address: HOME, latLng: null },
    to: { address: '', latLng: { lat: 35.64, lng: 139.67 } },
  },
  move: null,
  leaving: null,
} as unknown as AppointmentLegPlan;

describe('RouteCalculator の共有キャッシュ', () => {
  it('キーは住所・座標を含まないハッシュで、テナントごとに分かれる', () => {
    const key = mapsCacheKey('tenant-1', 'geocode', HOME);
    expect(key).toMatch(/^maps:v2:geocode:[0-9a-f]{64}$/);
    expect(key).not.toContain('世田谷');
    expect(mapsCacheKey('tenant-2', 'geocode', HOME)).not.toBe(key);
  });

  it('公共交通機関は時刻で結果が変わるため1時間、それ以外は6時間使い回す', async () => {
    let now = 0;
    const cache = new InMemoryTtlCache({ maxEntries: 10, now: () => now });
    const maps = new CountingMaps();
    const run = (mode: 'car' | 'transit') =>
      new RouteCalculator(maps, '2026-09-25', mode, { cache, tenantId: 't', read: true }).summarizePlan(plan);

    await run('car');
    await run('transit');
    expect(maps.routes).toBe(2);
    now = 60 * 60 * 1000;
    await run('car');
    await run('transit');
    expect(maps.routes).toBe(3);
    now = 6 * 60 * 60 * 1000;
    await run('car');
    expect(maps.routes).toBe(4);
  });

  it('見つからなかった住所(null)は30分だけ覚える(開くたびに課金されないように)', async () => {
    let now = 0;
    const cache = new InMemoryTtlCache({ maxEntries: 10, now: () => now });
    let calls = 0;
    const maps: MapsPort = {
      geocode: async () => {
        calls++;
        return null;
      },
      route: async () => null,
    };
    const shared = { cache, tenantId: 't', read: true };
    const first = new RouteCalculator(maps, '2026-09-25', 'car', shared);
    await first.summarizePlan(plan);
    expect(first.usage).toEqual({ geocodeCalls: 1, routeCalls: 0, cacheHits: 0 });
    now = 30 * 60 * 1000 - 1;
    const second = new RouteCalculator(maps, '2026-09-25', 'car', shared);
    await second.summarizePlan(plan);
    expect(second.usage).toEqual({ geocodeCalls: 0, routeCalls: 0, cacheHits: 1 });
    expect(calls).toBe(1);
    now = 30 * 60 * 1000;
    await new RouteCalculator(maps, '2026-09-25', 'car', shared).summarizePlan(plan);
    expect(calls).toBe(2);
    // 共有キャッシュを使わない計算(fresh)は覚えた値を読まない
    await new RouteCalculator(maps, '2026-09-25', 'car', null).summarizePlan(plan);
    expect(calls).toBe(3);
  });
});
