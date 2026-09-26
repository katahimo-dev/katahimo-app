import { beforeEach, describe, expect, it } from 'vitest';
import type { LatLng, MapsPort } from '../ports/maps';
import { updateAttendanceDay } from './attendance';
import type { Actor } from './requestMeta';
import { listActiveStaffForActor } from './staff';
import {
  createStaffByAdmin,
  deleteStaffByAdmin,
  listStaffForAdmin,
  sendPasswordGuideByAdmin,
  updateStaffByAdmin,
} from './staffAdmin';
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
    const { staff: created } = await createStaffByAdmin(ctx.deps, admin, {
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
    const { staff: withPassword } = await createStaffByAdmin(ctx.deps, admin, {
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
    const { staff: target } = await createStaffByAdmin(ctx.deps, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
    });
    const { staff: updated } = await updateStaffByAdmin(ctx.deps, admin, target.id, {
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
    const { staff: retired } = await updateStaffByAdmin(ctx.deps, admin, target.id, {
      retiredOn: '2026-09-01',
    });
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
    const { staff: a } = await createStaffByAdmin(ctx.deps, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
    });
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

/** 住所 → 緯度経度。'不明' を含む住所は見つからない、fail で地図APIの失敗。 */
class FakeGeocoder implements MapsPort {
  calls: string[] = [];
  fail = false;
  async geocode(address: string): Promise<LatLng | null> {
    this.calls.push(address);
    if (this.fail) throw new Error('Geocoding API エラー: HTTP 429');
    return address.includes('不明') ? null : { lat: 35.6264, lng: 139.6336 };
  }
  async route() {
    return null;
  }
}

describe('管理者によるスタッフ管理(自宅・移動手段・カレンダー・版)', () => {
  let ctx: TestContext;
  let admin: Actor;
  let maps: FakeGeocoder;
  const rowOf = (id: string) => ctx.data().staff.find((s) => s.record.id === id);

  beforeEach(async () => {
    ctx = createTestContext();
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    maps = new FakeGeocoder();
  });

  it('カナ・自宅・移動手段・性別・予定のカレンダーを登録でき、自宅はジオコーディングして区画も保存する', async () => {
    const { staff, homeGeocode } = await createStaffByAdmin({ ...ctx.deps, maps }, admin, {
      name: '佐藤 花子',
      kana: 'ｻﾄｳ ﾊﾅｺ',
      email: 'hanako@example.com',
      role: 'staff',
      homeAddress: ' 東京都世田谷区用賀4-1-1 ',
      travelMode: 'bicycle',
      gender: 'female',
      scheduleCalendarId: 'hanako@cutest.biz',
    });
    expect(homeGeocode).toBe('ok');
    expect(staff).toMatchObject({
      kana: 'サトウ ハナコ',
      homeAddress: '東京都世田谷区用賀4-1-1',
      hasHomeGeo: true,
      travelMode: 'bicycle',
      gender: 'female',
      scheduleCalendarId: 'hanako@cutest.biz',
      rowVersion: 1,
    });
    expect(rowOf(staff.id)).toMatchObject({
      record: { familyNameKana: 'サトウ', givenNameKana: 'ハナコ', homeGeo: { lat: 35.6264, lng: 139.6336 } },
      homeGeoCell: expect.stringMatching(/^[0-9b-hjkmnp-z]{6}$/),
    });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      action: 'staff.admin.created',
      details: { homeGeocode: 'ok' },
    });
    expect(JSON.stringify(ctx.appLog.entries)).not.toContain('用賀');
  });

  it('ジオコーディングできなくても住所は保存し、緯度経度は空にして結果を返す(地図APIが無い環境は unavailable)', async () => {
    maps.fail = true;
    const failed = await createStaffByAdmin({ ...ctx.deps, maps }, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
      homeAddress: '東京都世田谷区用賀4-1-1',
    });
    expect(failed.homeGeocode).toBe('failed');
    expect(failed.staff).toMatchObject({ homeAddress: '東京都世田谷区用賀4-1-1', hasHomeGeo: false });

    const unavailable = await createStaffByAdmin(ctx.deps, admin, {
      name: 'B',
      email: 'b@example.com',
      role: 'staff',
      homeAddress: '東京都渋谷区道玄坂1-1',
    });
    expect(unavailable.homeGeocode).toBe('unavailable');
    expect(unavailable.staff.homeAddress).toBe('東京都渋谷区道玄坂1-1');
  });

  it('住所を変えると緯度経度も置き換え(見つからなければ空)、同じ住所のままならジオコーディングしない', async () => {
    const deps = { ...ctx.deps, maps };
    const { staff } = await createStaffByAdmin(deps, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
      homeAddress: '東京都世田谷区用賀4-1-1',
    });
    const moved = await updateStaffByAdmin(deps, admin, staff.id, { homeAddress: '不明な住所' });
    expect(moved.homeGeocode).toBe('not_found');
    expect(moved.staff).toMatchObject({ homeAddress: '不明な住所', hasHomeGeo: false });
    expect(rowOf(staff.id)?.homeGeoCell).toBeNull();

    maps.calls = [];
    const same = await updateStaffByAdmin(deps, admin, staff.id, { homeAddress: '不明な住所', phone: '090' });
    expect(same.homeGeocode).toBeNull();
    expect(maps.calls).toEqual([]);

    const cleared = await updateStaffByAdmin(deps, admin, staff.id, { homeAddress: null });
    expect(cleared.staff).toMatchObject({ homeAddress: null, hasHomeGeo: false });
  });

  it('rowVersion が古ければ conflict。カレンダーは付け替え・外しができる', async () => {
    const { staff } = await createStaffByAdmin(ctx.deps, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
      scheduleCalendarId: 'a@cutest.biz',
    });
    const updated = await updateStaffByAdmin(ctx.deps, admin, staff.id, {
      scheduleCalendarId: 'a2@cutest.biz',
      rowVersion: staff.rowVersion,
    });
    expect(updated.staff).toMatchObject({ scheduleCalendarId: 'a2@cutest.biz', rowVersion: 2 });
    await expect(
      updateStaffByAdmin(ctx.deps, admin, staff.id, { phone: '090', rowVersion: staff.rowVersion }),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'stale_row_version' });
    expect(ctx.appLog.byAction('staff.admin.update_rejected').at(-1)?.details).toEqual({
      reason: 'stale_row_version',
    });
    const removed = await updateStaffByAdmin(ctx.deps, admin, staff.id, { scheduleCalendarId: null });
    expect(removed.staff.scheduleCalendarId).toBeNull();
    expect(ctx.data().calendars).toEqual([]);
  });

  it('記録の無いスタッフは削除でき、出勤簿などの記録があれば 409(退職日の案内)。自分自身は削除できない', async () => {
    const { staff: mistaken } = await createStaffByAdmin(ctx.deps, admin, {
      name: '間違い',
      email: 'wrong@example.com',
      role: 'staff',
    });
    await deleteStaffByAdmin(ctx.deps, admin, mistaken.id);
    expect(rowOf(mistaken.id)).toBeUndefined();
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'staff.admin.deleted',
      targetStaffId: mistaken.id,
    });

    const worker = await ctx.addStaff('山田 太郎', 'taro@example.com');
    await updateAttendanceDay(ctx.deps, worker.actor, worker.staff.id, '2026-09-24', { C: '佐藤様' });
    await expect(deleteStaffByAdmin(ctx.deps, admin, worker.staff.id)).rejects.toMatchObject({
      code: 'conflict',
      reason: 'staff_has_records',
      message: expect.stringContaining('退職日を設定してください'),
    });
    expect(rowOf(worker.staff.id)).toBeDefined();
    await expect(deleteStaffByAdmin(ctx.deps, admin, admin.staffId)).rejects.toMatchObject({
      reason: 'cannot_delete_self',
    });
    await expect(deleteStaffByAdmin(ctx.deps, admin, mistaken.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(ctx.appLog.byAction('staff.admin.delete_rejected').map((e) => e.details)).toEqual([
      { reason: 'staff_has_records' },
      { reason: 'cannot_delete_self' },
      { reason: 'not_found' },
    ]);
  });

  it('パスワード設定の案内: 未設定のスタッフに再設定コードを発行して案内のメールを送る。設定済み・退職者には送らない', async () => {
    const { staff } = await createStaffByAdmin(ctx.deps, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
    });
    expect(await sendPasswordGuideByAdmin(ctx.deps, admin, staff.id)).toEqual({ status: 'queued' });
    expect(ctx.data().outbox.at(-1)).toMatchObject({
      topic: 'mail.password_reset',
      payload: { purpose: 'setup_guide' },
    });
    await ctx.drain();
    expect(ctx.mailer.sent.at(-1)).toMatchObject({
      to: 'a@example.com',
      subject: '【保育日報】パスワード設定のご案内',
      text: expect.stringMatching(/コード: \d{6}/),
    });
    expect(ctx.appLog.entries.at(-1)).toMatchObject({
      level: 'SECURITY',
      action: 'staff.admin.password_guide_sent',
      details: { passwordStatus: 'unset' },
    });

    await expect(sendPasswordGuideByAdmin(ctx.deps, admin, admin.staffId)).rejects.toMatchObject({
      reason: 'password_already_set',
    });
    await updateStaffByAdmin(ctx.deps, admin, staff.id, { retiredOn: '2026-09-01' });
    await expect(sendPasswordGuideByAdmin(ctx.deps, admin, staff.id)).rejects.toMatchObject({
      reason: 'retired',
    });
  });

  it('パスワード設定の案内は本人の再設定の要求と回数の上限を共有する', async () => {
    const { staff } = await createStaffByAdmin(ctx.deps, admin, {
      name: 'A',
      email: 'a@example.com',
      role: 'staff',
    });
    const limit = ctx.deps.rateLimits.passwordResetRequestAccount.limit;
    for (let i = 0; i < limit; i++) await sendPasswordGuideByAdmin(ctx.deps, admin, staff.id);
    expect(await sendPasswordGuideByAdmin(ctx.deps, admin, staff.id)).toMatchObject({
      status: 'rate_limited',
    });
    expect(ctx.appLog.byAction('staff.admin.password_guide_rejected').at(-1)?.details).toEqual({
      reason: 'rate_limited',
    });
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
    kana: null,
    phone: null,
    email: 'hanako@gmail.com',
    homeAddress: null,
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
    expect(result).toEqual({ created: 3, updated: 0, skipped: [], homeWithoutGeo: 0 });
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
    expect(result).toEqual({ created: 0, updated: 1, skipped: [], homeWithoutGeo: 0 });
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

  it('取込では権限を下げない(本アプリで付けた管理者は台帳の K 列が空でも管理者のまま)。K 列=1 なら管理者にする', async () => {
    await ctx.addStaff('佐藤 花子', 'hanako@gmail.com', 'admin');
    await ctx.addStaff('鈴木 一郎', 'suzuki@gmail.com', 'staff');
    await importStaffMasterRows(ctx.deps, ctx.tenantId, [
      row({ isAdmin: false }),
      row({ rowNumber: 3, name: '鈴木 一郎', email: 'suzuki@gmail.com', isAdmin: true }),
    ]);
    expect(credentialsOf('hanako@gmail.com')?.record.role).toBe('admin');
    expect(credentialsOf('suzuki@gmail.com')?.record.role).toBe('admin');
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

  it('カナ・電話・住所を取り込み、空欄は既存の値を消さない。住所が変わったら緯度経度を置き換える', async () => {
    const maps = new FakeGeocoder();
    const deps = { ...ctx.deps, maps };
    await importStaffMasterRows(deps, ctx.tenantId, [
      row({ kana: 'サトウ ハナコ', phone: '090-1111-2222', homeAddress: '東京都世田谷区用賀4-1-1' }),
    ]);
    const imported = () => credentialsOf('hanako@gmail.com');
    expect(imported()).toMatchObject({
      record: {
        familyNameKana: 'サトウ',
        givenNameKana: 'ハナコ',
        phone: '090-1111-2222',
        homeAddress: '東京都世田谷区用賀4-1-1',
        homeGeo: { lat: 35.6264, lng: 139.6336 },
      },
      homeGeoCell: expect.any(String),
    });

    maps.calls = [];
    await importStaffMasterRows(deps, ctx.tenantId, [row({})]);
    expect(imported()?.record).toMatchObject({
      familyNameKana: 'サトウ',
      phone: '090-1111-2222',
      homeAddress: '東京都世田谷区用賀4-1-1',
      homeGeo: { lat: 35.6264, lng: 139.6336 },
    });
    await importStaffMasterRows(deps, ctx.tenantId, [row({ homeAddress: '東京都世田谷区用賀4-1-1' })]);
    expect(maps.calls).toEqual([]);

    const moved = await importStaffMasterRows(deps, ctx.tenantId, [row({ homeAddress: '不明な住所' })]);
    expect(moved.homeWithoutGeo).toBe(1);
    expect(imported()).toMatchObject({
      record: { homeAddress: '不明な住所', homeGeo: null },
      homeGeoCell: null,
    });
  });

  it('地図APIが無い環境では住所だけを保存し、古い緯度経度は消す', async () => {
    await importStaffMasterRows({ ...ctx.deps, maps: new FakeGeocoder() }, ctx.tenantId, [
      row({ homeAddress: '東京都世田谷区用賀4-1-1' }),
    ]);
    const result = await importStaffMasterRows(ctx.deps, ctx.tenantId, [
      row({ homeAddress: '東京都渋谷区道玄坂1-1' }),
    ]);
    expect(result.homeWithoutGeo).toBe(1);
    expect(credentialsOf('hanako@gmail.com')?.record).toMatchObject({
      homeAddress: '東京都渋谷区道玄坂1-1',
      homeGeo: null,
    });
  });

  it('dryRun では件数だけ数えて何も書き込まない', async () => {
    const result = await importStaffMasterRows(ctx.deps, ctx.tenantId, [row({})], { dryRun: true });
    expect(result.created).toBe(1);
    expect(ctx.data().staff).toEqual([]);
    expect(ctx.appLog.entries).toEqual([]);
  });
});
