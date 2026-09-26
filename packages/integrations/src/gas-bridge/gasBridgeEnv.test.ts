import { describe, expect, it } from 'vitest';
import { GasBridgeTenantGuard, gasBridgeConfigOf, gasBridgeEnvProblems } from './gasBridgeEnv';

const bridge = {
  GAS_BRIDGE_URL: 'https://script.google.com/macros/s/x/exec',
  GAS_BRIDGE_SECRET: 's',
  GAS_BRIDGE_TENANT: 'cutest',
};

describe('GAS Bridge の設定', () => {
  it('URL・シークレット・持ち主のテナントは3つ揃えて設定する', () => {
    expect(gasBridgeEnvProblems(bridge)).toEqual([]);
    expect(gasBridgeEnvProblems({})).toEqual([]);
    expect(gasBridgeEnvProblems({ ...bridge, GAS_BRIDGE_TENANT: undefined }).join()).toMatch(/3つ揃えて/);
    expect(gasBridgeConfigOf({ ...bridge, GAS_BRIDGE_TENANT: undefined })).toBeNull();
    expect(gasBridgeConfigOf(bridge)).toMatchObject({ tenantSlug: 'cutest' });
  });

  it('ミラー・SCHEDULE_PROVIDER=gas_bridge を有効にするには持ち主のテナントまで要る', () => {
    expect(gasBridgeEnvProblems({ MIRROR_TO_GOOGLE_SHEETS: true }).join()).toMatch(
      /MIRROR_TO_GOOGLE_SHEETS=true には .*GAS_BRIDGE_TENANT/,
    );
    expect(
      gasBridgeEnvProblems({
        MIRROR_TO_GOOGLE_SHEETS: true,
        GAS_BRIDGE_URL: bridge.GAS_BRIDGE_URL,
        GAS_BRIDGE_SECRET: 's',
      }).join(),
    ).toMatch(/MIRROR_TO_GOOGLE_SHEETS=true/);
    expect(gasBridgeEnvProblems({ SCHEDULE_PROVIDER: 'gas_bridge' }).join()).toMatch(
      /SCHEDULE_PROVIDER=gas_bridge/,
    );
    expect(
      gasBridgeEnvProblems({ ...bridge, MIRROR_TO_GOOGLE_SHEETS: true, SCHEDULE_PROVIDER: 'gas_bridge' }),
    ).toEqual([]);
  });

  it('GasBridgeTenantGuard は持ち主のテナントだけを通し、合ったテナントは2回目から DB を読まない', async () => {
    let reads = 0;
    const guard = new GasBridgeTenantGuard('cutest', {
      findById: async (id) => {
        reads++;
        return {
          id,
          slug: id === 't-cutest' ? 'cutest' : 'other',
          name: '',
          status: 'active',
          timezone: 'Asia/Tokyo',
          businessType: 'babysitting',
        };
      },
    });
    await guard.assertAllowed('t-cutest');
    await guard.assertAllowed('t-cutest');
    expect(reads).toBe(1);
    await expect(guard.assertAllowed('t-other')).rejects.toThrow('テナント cutest');
    await expect(guard.assertAllowed(undefined)).rejects.toThrow('テナント cutest');
  });
});
