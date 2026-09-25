import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthDeps } from './auth';
import { registerStaff } from './auth';
import type { StaffDeps } from './staff';
import { listActiveStaffForAdmin } from './staff';
import {
  FakePasswordHasherPort,
  FakeSessionRepository,
  FakeStaffRepository,
  FakeTenantRepository,
} from './testDoubles';

describe('listActiveStaffForAdmin', () => {
  let deps: StaffDeps;
  let authDeps: AuthDeps;
  let staffRepo: FakeStaffRepository;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    staffRepo = new FakeStaffRepository();
    deps = { staff: staffRepo };
    authDeps = {
      tenants: new FakeTenantRepository(),
      staff: staffRepo,
      sessions: new FakeSessionRepository(),
      passwordHasher: new FakePasswordHasherPort(),
    };
  });

  it('氏名を復号し、単純な文字列比較で並び替えて返す', async () => {
    await registerStaff(authDeps, {
      tenantId,
      name: '鈴木 三郎',
      email: 'suzuki@example.com',
      password: 'pw',
      isAdmin: false,
    });
    await registerStaff(authDeps, {
      tenantId,
      name: '佐藤 花子',
      email: 'sato@example.com',
      password: 'pw',
      isAdmin: true,
    });

    const result = await listActiveStaffForAdmin(deps, tenantId);
    expect(result.map((s) => s.name)).toEqual(['佐藤 花子', '鈴木 三郎']);
  });

  it('退職済み(退職日が今日以前)のスタッフは除外する', async () => {
    const active = await registerStaff(authDeps, {
      tenantId,
      name: '田中 一郎',
      email: 'tanaka@example.com',
      password: 'pw',
      isAdmin: false,
    });
    const retired = await registerStaff(authDeps, {
      tenantId,
      name: '高橋 四郎',
      email: 'takahashi@example.com',
      password: 'pw',
      isAdmin: false,
    });
    staffRepo.setRetirementDateForTest(tenantId, retired.id, '2020-01-01');

    const result = await listActiveStaffForAdmin(deps, tenantId);
    expect(result.map((s) => s.id)).toEqual([active.id]);
  });

  it('別テナントのスタッフは含めない', async () => {
    await registerStaff(authDeps, {
      tenantId: 'tenant-1',
      name: '佐藤 花子',
      email: 'sato@example.com',
      password: 'pw',
      isAdmin: false,
    });
    await registerStaff(authDeps, {
      tenantId: 'tenant-2',
      name: '鈴木 三郎',
      email: 'suzuki@example.com',
      password: 'pw',
      isAdmin: false,
    });

    const result = await listActiveStaffForAdmin(deps, 'tenant-1');
    expect(result.map((s) => s.name)).toEqual(['佐藤 花子']);
  });
});
