import { describe, expect, it } from 'vitest';
import { InMemoryTtlCache } from '../cache';
import { GasBridgeMapsPort, GasBridgeSchedulePort } from '../gas-bridge';
import { GoogleMapsPlatformPort } from '../google-maps';
import { GoogleSchedulePort } from '../google-schedule';
import { NoopMapsPort, NoopSchedulePort } from '../noop';
import type { ScheduleServiceDeps } from './scheduleProvider';
import { createScheduleServices, scheduleEnvProblems, selectScheduleProvider } from './scheduleProvider';

const bridge = { GAS_BRIDGE_URL: 'https://script.google.com/macros/s/x/exec', GAS_BRIDGE_SECRET: 's' };
const google = { GOOGLE_MAPS_API_KEY: 'key', GOOGLE_APPLICATION_CREDENTIALS: '/secrets/sa.json' };
const deps: ScheduleServiceDeps = {
  directory: { load: async () => ({ staff: [], customers: [] }) },
  appLog: { write: async () => {} },
  routeCache: new InMemoryTtlCache({ maxEntries: 1 }),
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
    expect(selectScheduleProvider({})).toBe('noop');
  });
});

describe('createScheduleServices', () => {
  it('provider ごとに SchedulePort / MapsPort を組み立てる', () => {
    const g = createScheduleServices({ SCHEDULE_PROVIDER: 'google', GOOGLE_MAPS_API_KEY: 'key' }, deps);
    expect(g.schedule).toBeInstanceOf(GoogleSchedulePort);
    expect(g.maps).toBeInstanceOf(GoogleMapsPlatformPort);

    const b = createScheduleServices(bridge, deps);
    expect(b.provider).toBe('gas_bridge');
    expect(b.schedule).toBeInstanceOf(GasBridgeSchedulePort);
    expect(b.maps).toBeInstanceOf(GasBridgeMapsPort);

    const n = createScheduleServices({}, deps);
    expect(n.schedule).toBeInstanceOf(NoopSchedulePort);
    expect(n.maps).toBeInstanceOf(NoopMapsPort);
  });

  it('明示指定した実装に必要な設定が無ければ起動時に例外', () => {
    expect(() => createScheduleServices({ SCHEDULE_PROVIDER: 'google' }, deps)).toThrow(
      'GOOGLE_MAPS_API_KEY',
    );
    expect(() => createScheduleServices({ SCHEDULE_PROVIDER: 'gas_bridge' }, deps)).toThrow('GAS_BRIDGE_URL');
  });
});

describe('scheduleEnvProblems', () => {
  it('本番だけ SCHEDULE_PROVIDER の明示を要求する(資格情報からの自動選択に頼らない)', () => {
    expect(scheduleEnvProblems({ ...google }, false)).toEqual([]);
    expect(scheduleEnvProblems({ SCHEDULE_PROVIDER: 'google' }, true)).toEqual([]);
    expect(scheduleEnvProblems({ ...google }, true).join()).toMatch(/SCHEDULE_PROVIDER/);
  });
});
