import { EMPTY_CALENDAR_SETTINGS } from '@katahimo/core/domain';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryTtlCache } from '../cache';
import { GasBridgeSchedulePort } from '../gas-bridge';
import { GoogleMapsPlatformPort } from '../google-maps';
import { GoogleSchedulePort } from '../google-schedule';
import { NoopSchedulePort } from '../noop';
import type { ScheduleServiceDeps } from './scheduleProvider';
import { createScheduleServices, scheduleEnvProblems, selectScheduleProvider } from './scheduleProvider';

const bridge = {
  GAS_BRIDGE_URL: 'https://script.google.com/macros/s/x/exec',
  GAS_BRIDGE_SECRET: 's',
  GAS_BRIDGE_TENANT: 'cutest',
};
const google = { GOOGLE_MAPS_API_KEY: 'key', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json' };
const deps: ScheduleServiceDeps = {
  directory: { load: async () => ({ staff: [], customers: [], calendarSettings: EMPTY_CALENDAR_SETTINGS }) },
  appLog: { write: async () => {} },
  routeCache: new InMemoryTtlCache({ maxEntries: 1 }),
  tenants: {
    findById: async (id) =>
      ({ cutest: 'cutest', other: 'other' })[id]
        ? {
            id,
            slug: id,
            name: id,
            status: 'active',
            timezone: 'Asia/Tokyo',
            businessType: 'babysitting',
          }
        : null,
  },
};

describe('selectScheduleProvider', () => {
  it('明示指定を最優先する', () => {
    expect(selectScheduleProvider({ SCHEDULE_PROVIDER: 'gas_bridge', ...google, ...bridge })).toBe(
      'gas_bridge',
    );
    expect(selectScheduleProvider({ SCHEDULE_PROVIDER: 'noop', ...google })).toBe('noop');
  });

  it('未指定なら Google の資格情報 → GASブリッジ → noop の順', () => {
    expect(selectScheduleProvider({ ...google, ...bridge })).toBe('google');
    expect(selectScheduleProvider({ GOOGLE_MAPS_API_KEY: 'key', ...bridge })).toBe('gas_bridge');
    expect(selectScheduleProvider({ GOOGLE_MAPS_API_KEY: 'key' })).toBe('noop');
    expect(selectScheduleProvider({ GAS_BRIDGE_URL: 'x' })).toBe('noop');
    // 持ち主のテナントの無い Bridge は選ばない
    expect(selectScheduleProvider({ ...bridge, GAS_BRIDGE_TENANT: undefined })).toBe('noop');
    expect(selectScheduleProvider({})).toBe('noop');
  });
});

describe('createScheduleServices', () => {
  it('provider ごとに SchedulePort / MapsPort を組み立てる', () => {
    const g = createScheduleServices({ SCHEDULE_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'key' }, deps);
    expect(g.schedule).toBeInstanceOf(GoogleSchedulePort);
    expect(g.maps).toBeInstanceOf(GoogleMapsPlatformPort);
    expect(g.scheduleTenantSlug).toBeNull();

    const b = createScheduleServices(bridge, deps);
    expect(b.provider).toBe('gas_bridge');
    expect(b.schedule).toBeInstanceOf(GasBridgeSchedulePort);
    // ルートは GAS版が計算するため、本アプリからは Bridge の地図を使わない(住所を Bridge に送らない)
    expect(b.maps).toBeNull();
    // 夜間のジョブは Bridge の持ち主のテナントだけを処理する
    expect(b.scheduleTenantSlug).toBe(bridge.GAS_BRIDGE_TENANT);

    const n = createScheduleServices({}, deps);
    expect(n.schedule).toBeInstanceOf(NoopSchedulePort);
    expect(n.maps).toBeNull();
    expect(n.scheduleTenantSlug).toBeNull();
  });

  it('gas_bridge は GAS_BRIDGE_TENANT のテナントの予定だけを Bridge に求める', async () => {
    const calls: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ success: true, appointments: [] }));
    });
    try {
      const { schedule } = createScheduleServices(bridge, deps);
      const target = { staffId: 's1', staffName: '山田 太郎' };
      await expect(schedule.getSchedule(target, '2026-09-26', { tenantId: 'cutest' })).resolves.toMatchObject(
        {
          success: true,
        },
      );
      await expect(schedule.getSchedule(target, '2026-09-26', { tenantId: 'other' })).rejects.toThrow(
        'テナント cutest',
      );
      await expect(schedule.getScheduleWithRoute(target, '2026-09-26', false, {})).rejects.toThrow(
        'テナント cutest',
      );
      expect(calls).toHaveLength(1);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('明示指定した実装に必要な設定が無ければ起動時に例外', () => {
    expect(() => createScheduleServices({ SCHEDULE_PROVIDER: 'google' }, deps)).toThrow(
      'GOOGLE_MAPS_API_KEY',
    );
    expect(() => createScheduleServices({ SCHEDULE_PROVIDER: 'gas_bridge' }, deps)).toThrow('GAS_BRIDGE_URL');
    expect(() =>
      createScheduleServices(
        { ...bridge, SCHEDULE_PROVIDER: 'gas_bridge', GAS_BRIDGE_TENANT: undefined },
        deps,
      ),
    ).toThrow('GAS_BRIDGE_TENANT');
  });
});

describe('scheduleEnvProblems', () => {
  it('本番だけ SCHEDULE_PROVIDER の明示を要求する(資格情報からの自動選択に頼らない)', () => {
    expect(scheduleEnvProblems({ ...google }, false)).toEqual([]);
    expect(scheduleEnvProblems({ SCHEDULE_PROVIDER: 'google' }, true)).toEqual([]);
    expect(scheduleEnvProblems({ ...google }, true).join()).toMatch(/SCHEDULE_PROVIDER/);
  });
});
