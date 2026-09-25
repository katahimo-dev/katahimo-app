import { beforeEach, describe, expect, it } from 'vitest';
import type { StaffAdminActor, StaffAdminDeps } from './staffAdmin';
import { createStaffByAdmin, listStaffForAdmin, updateStaffByAdmin } from './staffAdmin';
import type { StaffMasterRow } from './staffMasterImport';
import { importStaffMasterRows } from './staffMasterImport';
import { FakeAppLogPort, FakePasswordHasherPort, FakeStaffRepository } from './testDoubles';

describe('管理者によるスタッフ管理', () => {
  const tenantId = 'tenant-1';
  let deps: StaffAdminDeps;
  let staff: FakeStaffRepository;
  let appLog: FakeAppLogPort;
  let actor: StaffAdminActor;

  beforeEach(async () => {
    staff = new FakeStaffRepository();
    appLog = new FakeAppLogPort();
    deps = {
      staff,
      passwordHasher: new FakePasswordHasherPort(),
      appLog,
      now: () => new Date('2026-09-25T03:00:00Z'),
    };
    const admin = await staff.create({ tenantId, name: '管理者', email: 'admin@example.com', isAdmin: true });
    actor = { tenantId, staffId: admin.id };
  });

  it('スタッフを登録でき(初期パスワード省略時は未設定)、SECURITYログが残る', async () => {
    const result = await createStaffByAdmin(deps, actor, {
      name: ' 佐藤 花子 ',
      email: 'Hanako@Example.com',
      altEmail: 'hanako@cutest.biz',
      isAdmin: false,
    });
    expect(result).toMatchObject({
      ok: true,
      staff: {
        name: '佐藤 花子',
        email: 'hanako@example.com',
        altEmail: 'hanako@cutest.biz',
        passwordStatus: 'unset',
      },
    });
    expect(appLog.entries.at(-1)).toMatchObject({ level: 'SECURITY', action: 'staff.admin.created' });

    const withPassword = await createStaffByAdmin(deps, actor, {
      name: '鈴木',
      email: 'suzuki@example.com',
      isAdmin: false,
      initialPassword: 'initial-pass',
    });
    expect(withPassword.ok && withPassword.staff.passwordStatus).toBe('set');
  });

  it('email/altEmailは両列を跨いでテナント内で重複できない', async () => {
    await createStaffByAdmin(deps, actor, {
      name: 'A',
      email: 'a@example.com',
      altEmail: 'shared@cutest.biz',
      isAdmin: false,
    });
    expect(
      await createStaffByAdmin(deps, actor, { name: 'B', email: 'shared@cutest.biz', isAdmin: false }),
    ).toEqual({
      ok: false,
      reason: 'email_conflict',
      field: 'email',
    });
    expect(
      await createStaffByAdmin(deps, actor, {
        name: 'C',
        email: 'c@example.com',
        altEmail: 'A@example.com',
        isAdmin: false,
      }),
    ).toEqual({ ok: false, reason: 'email_conflict', field: 'altEmail' });
    expect(
      await createStaffByAdmin(deps, actor, {
        name: 'D',
        email: 'd@example.com',
        altEmail: 'd@example.com',
        isAdmin: false,
      }),
    ).toEqual({ ok: false, reason: 'email_conflict', field: 'altEmail' });
  });

  it('スタッフ情報を部分更新でき、自分自身の重複とはみなさない', async () => {
    const created = await createStaffByAdmin(deps, actor, {
      name: 'A',
      email: 'a@example.com',
      isAdmin: false,
    });
    if (!created.ok) throw new Error('unreachable');
    const result = await updateStaffByAdmin(deps, actor, created.staff.id, {
      email: 'a@example.com',
      altEmail: 'a@cutest.biz',
      retirementDate: '2026-09-25',
      phone: '090-0000-0000',
    });
    expect(result).toMatchObject({
      ok: true,
      staff: {
        altEmail: 'a@cutest.biz',
        retirementDate: '2026-09-25',
        isRetired: true,
        phone: '090-0000-0000',
      },
    });
    expect(appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'staff.admin.updated',
      targetStaffId: created.staff.id,
    });
  });

  it('他スタッフが使っているアドレスへの変更は拒否する', async () => {
    await createStaffByAdmin(deps, actor, { name: 'A', email: 'a@example.com', isAdmin: false });
    const b = await createStaffByAdmin(deps, actor, { name: 'B', email: 'b@example.com', isAdmin: false });
    if (!b.ok) throw new Error('unreachable');
    expect(await updateStaffByAdmin(deps, actor, b.staff.id, { altEmail: 'a@example.com' })).toEqual({
      ok: false,
      reason: 'email_conflict',
      field: 'altEmail',
    });
  });

  it('自分自身の管理者権限の解除・退職日設定はできない', async () => {
    expect(await updateStaffByAdmin(deps, actor, actor.staffId, { isAdmin: false })).toEqual({
      ok: false,
      reason: 'cannot_demote_self',
    });
    expect(await updateStaffByAdmin(deps, actor, actor.staffId, { retirementDate: '2026-10-01' })).toEqual({
      ok: false,
      reason: 'cannot_retire_self',
    });
    expect(await updateStaffByAdmin(deps, actor, 'no-such', { name: 'x' })).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('一覧は退職者を含み、退職済みかどうかをJSTの今日で判定する', async () => {
    await staff.create({
      tenantId,
      name: '退職者',
      email: 'r@example.com',
      isAdmin: false,
      retirementDate: '2026-09-25',
    });
    await staff.create({
      tenantId,
      name: '在籍者',
      email: 'x@example.com',
      isAdmin: false,
      retirementDate: '2026-09-26',
    });
    const list = await listStaffForAdmin(deps, tenantId);
    expect(list.map((s) => [s.name, s.isRetired])).toEqual(
      expect.arrayContaining([
        ['退職者', true],
        ['在籍者', false],
      ]),
    );
    expect(list).toHaveLength(3);
  });
});

describe('importStaffMasterRows(GAS版スタッフ台帳の一括取込)', () => {
  const tenantId = 'tenant-1';
  const legacyHash = 'a'.repeat(64);
  let staff: FakeStaffRepository;
  let appLog: FakeAppLogPort;
  const deps = () => ({ staff, passwordHasher: new FakePasswordHasherPort(), appLog });
  const row = (overrides: Partial<StaffMasterRow>): StaffMasterRow => ({
    rowNumber: 2,
    name: '佐藤 花子',
    email: 'hanako@gmail.com',
    altEmail: null,
    password: legacyHash,
    isAdmin: false,
    retirementDate: null,
    ...overrides,
  });

  beforeEach(() => {
    staff = new FakeStaffRepository();
    appLog = new FakeAppLogPort();
  });

  it('新規行は作成し、レガシーハッシュ・平文パスワード・空欄をそれぞれ扱う', async () => {
    const result = await importStaffMasterRows(deps(), tenantId, [
      row({ altEmail: 'hanako@cutest.biz', isAdmin: true }),
      row({ rowNumber: 3, name: '鈴木', email: 'suzuki@gmail.com', password: 'plain-pass' }),
      row({
        rowNumber: 4,
        name: '田中',
        email: 'tanaka@gmail.com',
        password: '',
        retirementDate: '2026-03-31',
      }),
    ]);
    expect(result).toEqual({ created: 3, updated: 0, skipped: [] });
    expect(await staff.findByLoginEmail(tenantId, 'hanako@cutest.biz')).toMatchObject({
      legacyPasswordHash: legacyHash,
      passwordHash: null,
      isAdmin: true,
    });
    expect(await staff.findByLoginEmail(tenantId, 'suzuki@gmail.com')).toMatchObject({
      passwordHash: 'HASH:plain-pass',
    });
    expect(await staff.findByLoginEmail(tenantId, 'tanaka@gmail.com')).toMatchObject({
      passwordHash: null,
      legacyPasswordHash: null,
      retirementDate: '2026-03-31',
    });
    expect(appLog.entries.at(-1)).toMatchObject({ level: 'SECURITY', action: 'staff.import.completed' });
  });

  it('既存スタッフはメールで照合して更新し、本アプリで設定済みのパスワードは上書きしない', async () => {
    const existing = await staff.create({
      tenantId,
      name: '旧姓 花子',
      email: 'hanako@gmail.com',
      passwordHash: 'HASH:already-set',
      isAdmin: false,
    });
    const result = await importStaffMasterRows(deps(), tenantId, [
      row({ isAdmin: true, retirementDate: '2027-01-01' }),
    ]);
    expect(result).toEqual({ created: 0, updated: 1, skipped: [] });
    expect(await staff.findById(tenantId, existing.id)).toMatchObject({
      name: '佐藤 花子',
      isAdmin: true,
      retirementDate: '2027-01-01',
      passwordHash: 'HASH:already-set',
      legacyPasswordHash: null,
    });
  });

  it('メールが空・CSV内の重複・他スタッフのアドレスとの衝突は取り込まずに理由を返す', async () => {
    await staff.create({ tenantId, name: '別人', email: 'other@gmail.com', isAdmin: false });
    const result = await importStaffMasterRows(deps(), tenantId, [
      row({ rowNumber: 2, email: '' }),
      row({ rowNumber: 3 }),
      row({ rowNumber: 4 }),
      row({ rowNumber: 5, email: 'x@gmail.com', altEmail: 'other@gmail.com' }),
    ]);
    expect(result.created).toBe(1);
    expect(result.skipped.map((s) => s.rowNumber)).toEqual([2, 4, 5]);
  });

  it('dryRunでは件数だけ数えて何も書き込まない', async () => {
    const result = await importStaffMasterRows(deps(), tenantId, [row({})], { dryRun: true });
    expect(result.created).toBe(1);
    expect(await staff.listAll(tenantId)).toEqual([]);
    expect(appLog.entries).toEqual([]);
  });
});
