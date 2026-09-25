import { summarizeLeg } from '@katahimo/core/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GasBridgeMapsPort } from './gasBridgeMapsPort';

describe('GasBridgeMapsPort', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Bridge.jsの分・km(小数2桁)を秒・mに戻し、表示用に丸め直してもGAS版と同じ値になる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: true, route: { durationMin: 13, distanceKm: 4.35 } })),
    );
    const maps = new GasBridgeMapsPort({ baseUrl: 'https://script.google.com/macros/s/x/exec', secret: 's' });
    const origin = { lat: 35.6, lng: 139.6 };
    const leg = await maps.route(origin, origin);
    expect(leg).not.toBeNull();
    expect(summarizeLeg(origin, origin, leg as NonNullable<typeof leg>, 'car')).toMatchObject({
      min: 13,
      km: '4.35',
    });
  });

  it('success:false は例外', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ success: false, message: '認証エラー' })),
    );
    const maps = new GasBridgeMapsPort({ baseUrl: 'https://script.google.com/macros/s/x/exec', secret: 's' });
    await expect(maps.geocode('東京')).rejects.toThrow('認証エラー');
  });
});
