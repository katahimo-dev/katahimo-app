import { beforeEach, describe, expect, it } from 'vitest';
import { decodeAuditLogCursor, exportAuditLogs, listAuditLogs } from './auditLogs';
import type { Actor } from './requestMeta';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

describe('操作ログの閲覧', () => {
  let ctx: TestContext;
  let admin: Actor;
  let staff: Actor;

  const write = (at: string, action: string, extra: Record<string, unknown> = {}) => {
    ctx.clock.now = new Date(at);
    return ctx.appLog.write({ tenantId: ctx.tenantId, level: 'INFO', action, ...extra });
  };

  beforeEach(async () => {
    ctx = createTestContext();
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    staff = (await ctx.addStaff('山田 太郎', 'taro@example.com')).actor;
    ctx.data().appLogs = [];
    await write('2026-09-10T00:00:00Z', 'old.event');
    await write('2026-09-20T00:00:00Z', 'auth.login.succeeded', { actorStaffId: staff.staffId });
    await write('2026-09-24T01:00:00Z', 'staff.admin.updated', {
      level: 'SECURITY',
      actorStaffId: admin.staffId,
      targetStaffId: staff.staffId,
      details: { changedFields: ['phone'] },
    });
    await write('2026-09-24T02:00:00Z', 'auth.login.failed', { level: 'WARN' });
    // ログイン前(テナント未特定)の記録と、別のテナントの記録は見えない
    await ctx.appLog.write({ tenantId: null, level: 'WARN', action: 'auth.login.failed' });
    const other = ctx.db.addTenant({ slug: 'other' });
    await ctx.appLog.write({ tenantId: other.id, level: 'INFO', action: 'other.event' });
    ctx.clock.now = new Date('2026-09-25T03:00:00Z');
  });

  it('既定は今日までの7日間(テナントのタイムゾーン)で新しい順。氏名を添え、最初のページの閲覧を記録する', async () => {
    const page = await listAuditLogs(ctx.deps, admin, { limit: 50 });
    expect(page.range).toEqual({ from: '2026-09-19', to: '2026-09-25' });
    expect(page.timeZone).toBe('Asia/Tokyo');
    expect(page.entries.map((e) => e.action)).toEqual([
      'auth.login.failed',
      'staff.admin.updated',
      'auth.login.succeeded',
    ]);
    expect(page.entries[1]).toMatchObject({
      level: 'SECURITY',
      actorName: '管理 者',
      targetName: '山田 太郎',
      details: { changedFields: ['phone'] },
    });
    expect(page.nextCursor).toBeNull();
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      action: 'audit_log.viewed',
      actorStaffId: admin.staffId,
      details: { from: '2026-09-19', to: '2026-09-25' },
    });
  });

  it('レベル・スタッフ(操作者か対象)・操作の前方一致で絞り込める', async () => {
    const byLevel = await listAuditLogs(ctx.deps, admin, { level: 'WARN', limit: 50 });
    expect(byLevel.entries.map((e) => e.action)).toEqual(['auth.login.failed']);
    const byStaff = await listAuditLogs(ctx.deps, admin, { staffId: staff.staffId, limit: 50 });
    expect(byStaff.entries.map((e) => e.action)).toEqual(['staff.admin.updated', 'auth.login.succeeded']);
    expect(ctx.appLog.entries.at(-1)?.targetStaffId).toBe(staff.staffId);
    const byAction = await listAuditLogs(ctx.deps, admin, { action: 'auth.', limit: 50 });
    expect(byAction.entries.map((e) => e.action)).toEqual(['auth.login.failed', 'auth.login.succeeded']);
  });

  it('keyset ページング: nextCursor で続きを読み、重複も抜けも無い。続きのページは閲覧を記録しない', async () => {
    const first = await listAuditLogs(ctx.deps, admin, { from: '2026-09-01', limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const logged = ctx.appLog.entries.length;
    const second = await listAuditLogs(ctx.deps, admin, {
      from: '2026-09-01',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(ctx.appLog.entries.length).toBe(logged);
    // 最初のページの後に書かれた閲覧の記録(audit_log.viewed)は続きのページに混ざらない
    expect([...first.entries, ...second.entries].map((e) => e.action)).toEqual([
      'auth.login.failed',
      'staff.admin.updated',
      'auth.login.succeeded',
      'old.event',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('93日を超える期間・逆転した期間・壊れた cursor は入力の誤り', async () => {
    await expect(
      listAuditLogs(ctx.deps, admin, { from: '2026-06-01', to: '2026-09-25', limit: 50 }),
    ).rejects.toMatchObject({ code: 'validation_failed', reason: 'range_too_long' });
    await expect(
      listAuditLogs(ctx.deps, admin, { from: '2026-09-25', to: '2026-09-01', limit: 50 }),
    ).rejects.toMatchObject({ reason: 'invalid_range' });
    expect(() => decodeAuditLogCursor('broken')).toThrow(
      expect.objectContaining({ reason: 'invalid_cursor' }),
    );
    await expect(
      listAuditLogs(ctx.deps, admin, { from: '2026-06-24', to: '2026-09-24', limit: 50 }),
    ).resolves.toBeDefined();
  });

  it('CSV 用の読み出しは条件に合う全件を返し、ダウンロードを SECURITY で記録する', async () => {
    const exported = await exportAuditLogs(ctx.deps, admin, { from: '2026-09-01' });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({ level: 'SECURITY', action: 'audit_log.exported' });
    const rows = [];
    for await (const batch of exported.entries()) rows.push(...batch);
    expect(rows.map((e) => e.action)).toEqual([
      'audit_log.exported',
      'auth.login.failed',
      'staff.admin.updated',
      'auth.login.succeeded',
      'old.event',
    ]);
  });
});
