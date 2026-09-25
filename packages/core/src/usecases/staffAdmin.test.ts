import { beforeEach, describe, expect, it } from 'vitest';
import type { Actor } from './requestMeta';
import { listActiveStaffForActor } from './staff';
import { createStaffByAdmin, listStaffForAdmin, updateStaffByAdmin } from './staffAdmin';
import type { StaffMasterRow } from './staffMasterImport';
import { importStaffMasterRows } from './staffMasterImport';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

describe('管理者によるスタッフ管理', () => {
  let ctx: TestContext;
  let admin: Actor;

  beforeEach(async () => {
    ctx = createTestContext();
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
  });

  it('スタッフを登録でき(初期パスワード省略時は未設定)、SECURITYログが残る', async () => {
    const created = await createStaffByAdmin(ctx.deps, admin, {
      name: ' 佐藤 花子 ',
      email: 'Hanako@Example.com',
      altEmail: 'hanako@cutest.biz',
      role: 'coordinator',
    });
    expect(created).toMatchObject({
      name: '佐藤 花子',
      email: 'hanako@example.com',
      altEmail: 'hanako@cutest.biz',
      role: 'coordinator',
      passwordStatus: 'unset',
      retiredOn: null,
    });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({ level: 'SECURITY', action: 'staff.admin.created' });
    const withPassword = await createStaffByAdmin(ctx.deps, admin, {
      name: '鈴木',
      email: 'suzuki@example.com',
      role: 'staff',
      initialPassword: 'initial-pass',
    });
    expect(withPassword.passwordStatus).toBe('set');
  });

  it('email/altEmail は両列を跨いでテナント内で重複できない(409、項目名つき)', async () => {
    await createStaffByAdmin(ctx.deps, admin, {
      name: 'A',
      email: 'a@example.com',
      altEmail: 'shared@cutest.biz',
      role: 'staff',
    });
    await expect(
      createStaffByAdmin(ctx.deps, admin, { name: 'B', email: 'shared@cutest.biz', role: 'staff' }),
    ).rejects.toMatchObject({ code: 'conflict', fields: { email: expect.any(String) } });
    expect(ctx.appLog.byAction('staff.admin.create_rejected')).toHaveLength(1);
  });

  it('部分更新でき、自分自身の重複とはみなさない。退職日を設定するとセッションを失効させる', async () => {
    const target = await createStaffByAdmin(ctx.deps, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
    });
    const updated = await updateStaffByAdmin(ctx.deps, admin, target.id, {
      email: 'a@example.com',
      phone: '090',
    });
    expect(updated.phone).toBe('090');
    await ctx.uow.run(ctx.tenantId, (r) =>
      r.sessions.create({
        id: '00000000-0000-7000-8000-0000000000f1',
        staffId: target.id,
        tokenHash: new Uint8Array([1]),
        createdAt: ctx.clock.now,
        idleExpiresAt: new Date(ctx.clock.now.getTime() + 1000),
        absoluteExpiresAt: new Date(ctx.clock.now.getTime() + 1000),
        ip: null,
        userAgent: null,
      }),
    );
    const retired = await updateStaffByAdmin(ctx.deps, admin, target.id, { retiredOn: '2026-09-01' });
    expect(retired).toMatchObject({ retiredOn: '2026-09-01', isRetired: true });
    expect(ctx.data().sessions.every((s) => s.revokedAt)).toBe(true);
  });

  it('自分自身の管理者権限の解除・退職日の設定はできない', async () => {
    await expect(updateStaffByAdmin(ctx.deps, admin, admin.staffId, { role: 'staff' })).rejects.toMatchObject(
      {
        reason: 'cannot_demote_self',
      },
    );
    await expect(
      updateStaffByAdmin(ctx.deps, admin, admin.staffId, { retiredOn: '2026-10-01' }),
    ).rejects.toMatchObject({
      reason: 'cannot_retire_self',
    });
  });

  it('一覧は退職者を含み、退職済みかはテナントのタイムゾーンの今日で判定する', async () => {
    const a = await createStaffByAdmin(ctx.deps, admin, { name: 'A', email: 'a@example.com', role: 'staff' });
    await updateStaffByAdmin(ctx.deps, admin, a.id, { retiredOn: '2026-09-26' });
    ctx.clock.now = new Date('2026-09-25T14:59:00Z'); // JST 9/25 23:59
    expect((await listStaffForAdmin(ctx.deps, ctx.tenantId)).find((s) => s.id === a.id)?.isRetired).toBe(
      false,
    );
    ctx.clock.now = new Date('2026-09-25T15:00:00Z'); // JST 9/26 00:00
    expect((await listStaffForAdmin(ctx.deps, ctx.tenantId)).find((s) => s.id === a.id)?.isRetired).toBe(
      true,
    );
  });
});

describe('対象スタッフの選択肢(listActiveStaffForActor)', () => {
  it('管理者・コーディネーターには退職者を除いた一覧、一般スタッフには空を返す', async () => {
    const ctx = createTestContext();
    const admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    const coordinator = (await ctx.addStaff('調整 役', 'coord@example.com', 'coordinator')).actor;
    const staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    const retired = await ctx.addStaff('退職 者', 'retired@example.com');
    ctx.setRetiredOn(retired.staff.id, '2026-01-01');
    const names = (await listActiveStaffForActor(ctx.deps, admin)).map((s) => s.name);
    expect(names).toEqual(['山田 太郎', '管理 者', '調整 役'].sort());
    expect(await listActiveStaffForActor(ctx.deps, coordinator)).toHaveLength(3);
    expect(await listActiveStaffForActor(ctx.deps, staff)).toEqual([]);
  });
});

describe('スタッフ台帳の取込', () => {
  let ctx: TestContext;
  const legacyHash = 'a'.repeat(64);
  const row = (overrides: Partial<StaffMasterRow>): StaffMasterRow => ({
    rowNumber: 2,
    name: '佐藤 花子',
    email: 'hanako@gmail.com',
    altEmail: null,
    password: legacyHash,
    isAdmin: false,
    retiredOn: null,
    ...overrides,
  });
  const credentialsOf = (email: string) => ctx.data().staff.find((s) => s.record.email === email);

  beforeEach(() => {
    ctx = createTestContext();
  });

  it('新規行は作成し、レガシーハッシュ・平文パスワード・空欄をそれぞれ扱い、import_runs に残す', async () => {
    const result = await importStaffMasterRows(ctx.deps, ctx.tenantId, [
      row({ altEmail: 'hanako@cutest.biz', isAdmin: true }),
      row({ rowNumber: 3, name: '鈴木', email: 'suzuki@gmail.com', password: 'plain-pass' }),
      row({ rowNumber: 4, name: '田中', email: 'tanaka@gmail.com', password: '', retiredOn: '2026-03-31' }),
    ]);
    expect(result).toEqual({ created: 3, updated: 0, skipped: [] });
    expect(credentialsOf('hanako@gmail.com')).toMatchObject({
      record: { role: 'admin', altEmail: 'hanako@cutest.biz' },
      credentials: { legacyPasswordHash: legacyHash, passwordHash: null },
    });
    expect(credentialsOf('suzuki@gmail.com')?.credentials.passwordHash).toBe('HASH:plain-pass');
    expect(credentialsOf('tanaka@gmail.com')).toMatchObject({
      record: { retiredOn: '2026-03-31' },
      credentials: { passwordHash: null, legacyPasswordHash: null },
    });
    expect(ctx.data().importRuns).toEqual([
      expect.objectContaining({ source: 'staff_master_csv', status: 'applied' }),
    ]);
    expect(ctx.appLog.entries.at(-1)).toMatchObject({ level: 'SECURITY', action: 'staff.import.completed' });
  });

  it('既存スタッフはメールで照合して更新し、設定済みのパスワードとコーディネーターの役割は保つ', async () => {
    const existing = await ctx.addStaff('旧姓 花子', 'hanako@gmail.com', 'coordinator', 'already-set');
    const result = await importStaffMasterRows(ctx.deps, ctx.tenantId, [row({ retiredOn: '2027-01-01' })]);
    expect(result).toEqual({ created: 0, updated: 1, skipped: [] });
    expect(credentialsOf('hanako@gmail.com')).toMatchObject({
      record: {
        id: existing.staff.id,
        displayName: '佐藤 花子',
        role: 'coordinator',
        retiredOn: '2027-01-01',
      },
      credentials: { passwordHash: 'HASH:already-set', legacyPasswordHash: null },
    });
  });

  it('メールが空・CSV内の重複・他スタッフのアドレスとの衝突は取り込まずに理由を返す', async () => {
    await ctx.addStaff('別人', 'other@gmail.com');
    const result = await importStaffMasterRows(ctx.deps, ctx.tenantId, [
      row({ rowNumber: 2, email: '' }),
      row({ rowNumber: 3 }),
      row({ rowNumber: 4 }),
      row({ rowNumber: 5, email: 'x@gmail.com', altEmail: 'other@gmail.com' }),
    ]);
    expect(result.created).toBe(1);
    expect(result.skipped.map((s) => s.rowNumber)).toEqual([2, 4, 5]);
  });

  it('dryRun では件数だけ数えて何も書き込まない', async () => {
    const result = await importStaffMasterRows(ctx.deps, ctx.tenantId, [row({})], { dryRun: true });
    expect(result.created).toBe(1);
    expect(ctx.data().staff).toEqual([]);
    expect(ctx.appLog.entries).toEqual([]);
  });
});
