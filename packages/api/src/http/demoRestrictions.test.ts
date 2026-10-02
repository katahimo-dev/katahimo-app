import type { TenantDirectoryPort, TenantRecord } from '@katahimo/core/ports';
import { DEFAULT_RATE_LIMIT_POLICY } from '@katahimo/core/usecases';
import { describe, expect, it } from 'vitest';
import { DEMO_RESTRICTION_RULES, DemoTenant, matchDemoRestriction } from './demoRestrictions';

describe('matchDemoRestriction', () => {
  it('断る操作を名前と :id つきで返す', () => {
    expect(matchDemoRestriction('post', '/api/auth/change-password')?.rule.name).toBe('auth.password_change');
    expect(matchDemoRestriction('PATCH', '/api/admin/staff/abc')).toMatchObject({
      rule: { name: 'staff.admin.update', demoAccountTargetOnly: true },
      targetId: 'abc',
    });
    expect(matchDemoRestriction('POST', '/api/admin/staff/abc/password-guide')?.targetId).toBe('abc');
    expect(matchDemoRestriction('POST', '/api/admin/staff/import')?.rule.name).toBe('staff.xlsx_import');
  });

  it('デモでも使える操作は当たらない(入力・編集・閲覧、スタッフの追加、プロンプトの編集)', () => {
    expect(matchDemoRestriction('POST', '/api/reports/daily')).toBeNull();
    expect(matchDemoRestriction('POST', '/api/admin/staff')).toBeNull();
    expect(matchDemoRestriction('GET', '/api/admin/staff/abc')).toBeNull();
    expect(matchDemoRestriction('PUT', '/api/settings/admin/prompts')).toBeNull();
    expect(matchDemoRestriction('POST', '/api/auth/login')).toBeNull();
  });

  it('規則の名前は重ならない', () => {
    const names = DEMO_RESTRICTION_RULES.map((r) => `${r.method} ${r.name}`);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('DemoTenant.isDemoTenant', () => {
  it('テナントの ID ごとの判定を覚え、一定時間で覚え直す(作り直しで前のテナントの slug が変わるため)', async () => {
    const tenant: TenantRecord = {
      id: 't1',
      slug: 'public-demo',
      name: 'デモ',
      status: 'active',
      timezone: 'Asia/Tokyo',
      businessType: 'babysitting',
    };
    let lookups = 0;
    const tenants = {
      findById: async (id: string) => {
        lookups++;
        return id === tenant.id ? { ...tenant } : null;
      },
    } as unknown as TenantDirectoryPort;
    let now = 0;
    const demo = new DemoTenant(
      { slug: 'public-demo', publicLogin: false, dataRetentionDays: 30, logRetentionMonths: 3 },
      tenants,
      () => now,
    );
    expect(await demo.isDemoTenant('t1')).toBe(true);
    expect(await demo.isDemoTenant('t1')).toBe(true);
    expect(lookups).toBe(1);
    // 見つからない ID は覚えない
    expect(await demo.isDemoTenant('gone')).toBe(false);
    expect(await demo.isDemoTenant('gone')).toBe(false);
    expect(lookups).toBe(3);
    // 作り直しで日付付きの slug に変わった後、覚え直すとデモではない
    tenant.slug = 'public-demo-20261001';
    now += 10 * 60 * 1000;
    expect(await demo.isDemoTenant('t1')).toBe(false);
    expect(lookups).toBe(4);
  });
});

describe('DemoTenant.loginRateLimits', () => {
  it('アカウント単位・端末単位のログインの失敗はロックしない(送信元IP単位は残す)', () => {
    const demo = new DemoTenant(
      { slug: 'public-demo', publicLogin: false, dataRetentionDays: 30, logRetentionMonths: 3 },
      {} as TenantDirectoryPort,
    );
    const policy = demo.loginRateLimits(DEFAULT_RATE_LIMIT_POLICY);
    for (const rule of [policy.loginFailureAccount, policy.loginFailureDevice]) {
      expect(rule.limit).toBe(Number.MAX_SAFE_INTEGER);
      expect(rule.lockMs).toBeUndefined();
    }
    expect(policy.loginFailureDevice.name).toBe(DEFAULT_RATE_LIMIT_POLICY.loginFailureDevice.name);
    expect(policy.loginFailureIp).toEqual(DEFAULT_RATE_LIMIT_POLICY.loginFailureIp);
  });
});
