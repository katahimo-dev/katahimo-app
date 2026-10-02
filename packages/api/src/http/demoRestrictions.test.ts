import { describe, expect, it } from 'vitest';
import { DEMO_RESTRICTION_RULES, matchDemoRestriction } from './demoRestrictions';

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
