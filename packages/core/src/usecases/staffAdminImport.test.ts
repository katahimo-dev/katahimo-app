import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportCell } from '../domain';
import type { LatLng, MapsPort } from '../ports/maps';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor } from './requestMeta';
import { createStaffByAdmin, updateStaffByAdmin } from './staffAdmin';
import { exportStaffSheet, importStaffSheet } from './staffAdminImport';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

class FakeGeocoder implements MapsPort {
  calls: string[] = [];
  async geocode(address: string): Promise<LatLng | null> {
    this.calls.push(address);
    return address.includes('不明') ? null : { lat: 35.6264, lng: 139.6336 };
  }
  async route() {
    return null;
  }
}

const sheets = (rows: ImportCell[][]) => [{ name: 'スタッフ', rows }];

describe('スタッフの xlsx の取込・書き出し', () => {
  let ctx: TestContext;
  let admin: Actor;
  let maps: FakeGeocoder;

  beforeEach(async () => {
    ctx = createTestContext();
    admin = (await ctx.addStaff('管理 者', 'admin@example.com', 'admin')).actor;
    maps = new FakeGeocoder();
    ctx.db.calendarSettings.set(ctx.tenantId, {
      sharedCalendars: [],
      allowedStaffCalendars: ['@cutest.biz'],
    });
  });

  const deps = () => ({ ...ctx.deps, maps });
  const dryRun = (rows: ImportCell[][]) =>
    importStaffSheet(deps(), admin, { sheets: sheets(rows), dryRun: true, fileName: 'staff.xlsx' });
  const applyWith = (rows: ImportCell[][], planDigest: string | null) =>
    importStaffSheet(deps(), admin, {
      sheets: sheets(rows),
      dryRun: false,
      fileName: 'staff.xlsx',
      planDigest,
    });
  /** 画面と同じ順: 確かめて(dryRun)、その planDigest を付けて反映する。 */
  const run = async (rows: ImportCell[][], dry: boolean) => {
    const checked = await dryRun(rows);
    return dry ? checked : applyWith(rows, checked.planDigest);
  };

  it('書き出しは退職者を含む全員で SECURITY を残し、そのまま取り込むと変更なし', async () => {
    await createStaffByAdmin(ctx.deps, admin, {
      name: '佐藤 花子',
      email: 'hanako@example.com',
      role: 'staff',
      travelMode: 'transit',
    });
    const exported = await exportStaffSheet(ctx.deps, admin);
    expect(exported.rows).toHaveLength(2);
    expect(ctx.appLog.byAction('staff.export.downloaded').at(-1)).toMatchObject({
      level: 'SECURITY',
      details: { count: 2 },
    });
    const result = await run([exported.header, ...exported.rows], false);
    expect(result).toMatchObject({
      applied: true,
      counts: { rows: 2, created: 0, updated: 0, unchanged: 2 },
      changes: [],
      errors: [],
    });
  });

  it('dryRun は変更を返すだけで何も書かない(import_runs・操作ログも残さない)', async () => {
    const logs = ctx.data().appLogs.length;
    const result = await run(
      [
        ['氏名', 'メールアドレス', '役割', '自宅住所'],
        ['新人 一郎', 'ichiro@example.com', 'コーディネーター', '東京都世田谷区'],
      ],
      true,
    );
    expect(result.planDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result).toMatchObject({
      dryRun: true,
      applied: false,
      counts: { rows: 1, created: 1, updated: 0, unchanged: 0 },
      changes: [
        {
          row: 2,
          kind: 'create',
          name: '新人 一郎',
          email: 'ichiro@example.com',
          fields: ['氏名', 'メールアドレス', '役割', '自宅住所'],
        },
      ],
    });
    expect(ctx.data().staff).toHaveLength(1);
    expect(ctx.data().importRuns).toHaveLength(0);
    expect(ctx.data().appLogs).toHaveLength(logs);
    expect(maps.calls).toEqual([]);
  });

  it('反映: 作成・更新を1回で書き、住所はジオコーディングし(見つからなければ住所だけで知らせる)、import_runs と SECURITY を残す', async () => {
    const { staff: hanako } = await createStaffByAdmin(ctx.deps, admin, {
      name: '佐藤 花子',
      email: 'hanako@example.com',
      phone: '090',
      role: 'staff',
    });
    const result = await run(
      [
        ['ID', '氏名', 'メールアドレス', '電話', '自宅住所', '予定カレンダーID'],
        [hanako.id, '佐藤 花子', 'hanako@example.com', '', '住所不明', 'Hanako@Cutest.biz'],
        [null, '新人 一郎', 'ichiro@example.com', '080', '東京都世田谷区', null],
      ],
      false,
    );
    expect(result).toMatchObject({
      applied: true,
      counts: { rows: 2, created: 1, updated: 1, unchanged: 0 },
      warnings: [{ row: 2, message: expect.stringContaining('住所だけを保存します') }],
    });
    expect(result.changes[0]?.fields).toEqual(['電話', '自宅住所', '予定カレンダーID']);
    const rows = ctx.data().staff.map((s) => s.record);
    expect(rows.find((s) => s.id === hanako.id)).toMatchObject({
      phone: null,
      homeAddress: '住所不明',
      homeGeo: null,
    });
    expect(rows.find((s) => s.email === 'ichiro@example.com')).toMatchObject({
      role: 'staff',
      phone: '080',
      homeAddress: '東京都世田谷区',
      homeGeo: { lat: 35.6264, lng: 139.6336 },
    });
    expect(ctx.data().calendars.find((c) => c.staffId === hanako.id)?.calendarId).toBe('hanako@cutest.biz');
    expect(ctx.data().importRuns).toEqual([
      expect.objectContaining({
        source: 'staff_xlsx',
        status: 'applied',
        fileName: 'staff.xlsx',
        counts: { rows: 2, created: 1, updated: 1, unchanged: 0 },
      }),
    ]);
    const log = ctx.appLog.byAction('staff.xlsx_import.applied').at(-1);
    expect(log).toMatchObject({
      level: 'SECURITY',
      details: {
        created: 1,
        updated: 1,
        warnings: 1,
        geocode: { geocoded: 1, notFound: 1, failed: 0 },
      },
    });
    expect(JSON.stringify(log?.details)).not.toContain('hanako');
    expect(JSON.stringify(log?.details)).not.toContain(result.planDigest);
    // スタッフごとの SECURITY(画面の登録・更新と同じ action。値は残さず項目の名前だけ)
    const runId = ctx.data().importRuns[0]?.id;
    const ichiro = rows.find((s) => s.email === 'ichiro@example.com');
    expect(ctx.appLog.byAction('staff.admin.updated').at(-1)).toMatchObject({
      level: 'SECURITY',
      targetStaffId: hanako.id,
      details: {
        via: 'staff_xlsx',
        importRunId: runId,
        changedFields: ['phone', 'homeAddress', 'scheduleCalendarId'],
        homeGeocode: 'not_found',
      },
    });
    expect(ctx.appLog.byAction('staff.admin.created').at(-1)).toMatchObject({
      level: 'SECURITY',
      targetStaffId: ichiro?.id,
      details: {
        via: 'staff_xlsx',
        importRunId: runId,
        changedFields: ['name', 'email', 'phone', 'homeAddress'],
        role: 'staff',
        initialPasswordSet: false,
        homeGeocode: 'ok',
      },
    });
    const perStaff = [
      ...ctx.appLog.byAction('staff.admin.updated'),
      ...ctx.appLog.byAction('staff.admin.created'),
    ].filter((l) => (l.details as { via?: string } | undefined)?.via === 'staff_xlsx');
    expect(perStaff).toHaveLength(2);
    for (const entry of perStaff) {
      const text = JSON.stringify(entry.details);
      for (const value of ['ichiro', 'hanako', '住所不明', '世田谷', '080', 'cutest']) {
        expect(text).not.toContain(value);
      }
    }
  });

  it('反映には確かめたときの planDigest が要る(無ければ 400 で何も読まない・書かない)', async () => {
    const rows: ImportCell[][] = [
      ['氏名', 'メールアドレス'],
      ['新人', 'new@example.com'],
    ];
    await expect(applyWith(rows, null)).rejects.toMatchObject({
      code: 'validation_failed',
      reason: 'plan_digest_required',
    });
    expect(ctx.data().staff).toHaveLength(1);
    expect(ctx.data().importRuns).toHaveLength(0);
  });

  it('確かめた後に対象のスタッフが画面から変えられたら(ファイルに無い列でも)409 import_stale で地図APIも呼ばない', async () => {
    const { staff: hanako } = await createStaffByAdmin(ctx.deps, admin, {
      name: '佐藤 花子',
      email: 'hanako@example.com',
      role: 'staff',
    });
    const rows: ImportCell[][] = [
      ['ID', '氏名', 'メールアドレス', '自宅住所'],
      [hanako.id, '佐藤 花子', 'hanako@example.com', '東京都世田谷区'],
    ];
    const checked = await dryRun(rows);
    await updateStaffByAdmin(ctx.deps, admin, hanako.id, { phone: '090' });
    await expect(applyWith(rows, checked.planDigest)).rejects.toMatchObject({
      code: 'conflict',
      reason: 'import_stale',
    });
    expect(maps.calls).toEqual([]);
    expect(ctx.data().staff.find((s) => s.record.id === hanako.id)?.record.homeAddress).toBeNull();
    expect(ctx.data().importRuns).toHaveLength(0);
    expect(ctx.appLog.byAction('staff.xlsx_import.rejected').at(-1)).toMatchObject({
      level: 'WARN',
      details: { reason: 'import_stale' },
    });
    // 別のファイルの指紋でも 409
    await expect(applyWith(rows, 'f'.repeat(64))).rejects.toMatchObject({ reason: 'import_stale' });
  });

  it('ファイルの中でメールアドレス・サブメールを入れ替えても反映できる', async () => {
    const taro = await ctx.addStaff('山田 太郎', 'taro@example.com');
    const jiro = await ctx.addStaff('山田 次郎', 'jiro@example.com');
    await updateStaffByAdmin(ctx.deps, admin, taro.staff.id, { altEmail: 'taro2@example.com' });
    const result = await run(
      [
        ['ID', '氏名', 'メールアドレス', 'サブメール'],
        [taro.staff.id, '山田 太郎', 'jiro@example.com', null],
        [jiro.staff.id, '山田 次郎', 'taro2@example.com', 'taro@example.com'],
      ],
      false,
    );
    expect(result).toMatchObject({ applied: true, counts: { updated: 2 } });
    const record = (id: string) => ctx.data().staff.find((s) => s.record.id === id)?.record;
    expect(record(taro.staff.id)).toMatchObject({ email: 'jiro@example.com', altEmail: null });
    expect(record(jiro.staff.id)).toMatchObject({
      email: 'taro2@example.com',
      altEmail: 'taro@example.com',
    });
  });

  it('誤りが1件でもあれば何も書かず(WARN)、誤りを返す', async () => {
    const result = await run(
      [
        ['氏名', 'メールアドレス'],
        ['A', 'a@example.com'],
        ['', 'b@example.com'],
      ],
      false,
    );
    expect(result).toMatchObject({
      applied: false,
      errors: [{ row: 3, message: '氏名: 氏名を入力してください' }],
    });
    expect(ctx.data().staff).toHaveLength(1);
    expect(ctx.data().importRuns).toHaveLength(0);
    expect(ctx.appLog.byAction('staff.xlsx_import.rejected').at(-1)).toMatchObject({ level: 'WARN' });
  });

  it('退職日が今日以前になったスタッフはセッションを失効させ、通知の購読を消す。先の日付は失効させない', async () => {
    const taro = await ctx.addStaff('山田 太郎', 'taro@example.com');
    const jiro = await ctx.addStaff('山田 次郎', 'jiro@example.com');
    for (const [i, staffId] of [taro.staff.id, jiro.staff.id].entries()) {
      await ctx.uow.run(ctx.tenantId, async (r) => {
        await r.sessions.create({
          id: `00000000-0000-7000-8000-0000000000f${i}`,
          staffId,
          tokenHash: new Uint8Array([i]),
          createdAt: ctx.clock.now,
          idleExpiresAt: new Date(ctx.clock.now.getTime() + 1000),
          absoluteExpiresAt: new Date(ctx.clock.now.getTime() + 1000),
          ip: null,
          userAgent: null,
        });
        await r.pushSubscriptions.upsert({
          id: `00000000-0000-7000-8000-0000000000e${i}`,
          staffId,
          endpoint: `https://push.example/${i}`,
          p256dh: 'k',
          auth: 'a',
          userAgent: null,
        });
      });
    }
    await run(
      [
        ['氏名', 'メールアドレス', '退職日'],
        ['山田 太郎', 'taro@example.com', '2026/9/25'],
        ['山田 次郎', 'jiro@example.com', new Date(Date.UTC(2026, 9, 31))],
      ],
      false,
    );
    const sessionOf = (id: string) => ctx.data().sessions.find((s) => s.staffId === id);
    expect(sessionOf(taro.staff.id)?.revokedAt).toBeTruthy();
    expect(sessionOf(jiro.staff.id)?.revokedAt).toBeFalsy();
    expect(ctx.data().pushSubscriptions.map((p) => p.staffId)).toEqual([jiro.staff.id]);
    expect(ctx.data().staff.find((s) => s.record.id === jiro.staff.id)?.record.retiredOn).toBe('2026-10-31');
  });

  it('自分自身の降格・最後の管理者を外す変更は誤り', async () => {
    const result = await run(
      [
        ['氏名', 'メールアドレス', '役割'],
        ['管理 者', 'admin@example.com', 'スタッフ'],
      ],
      false,
    );
    expect(result.errors).toEqual([
      { row: null, message: expect.stringContaining('管理者が1人もいなくなる') },
      { row: 2, message: '自分自身の管理者権限は解除できません' },
    ]);
    expect(ctx.data().staff[0]?.record.role).toBe('admin');
  });

  it('確かめた後・反映の前に他の変更で誤りになれば 409 で何も書かない', async () => {
    const rows: ImportCell[][] = [
      ['氏名', 'メールアドレス'],
      ['新人', 'new@example.com'],
    ];
    const checked = await dryRun(rows);
    let first = true;
    const racingUow: UnitOfWorkPort = {
      run: async (tenantId, fn) => {
        if (!first) {
          // 1回目(確かめる)と2回目(反映)の間に、同じアドレスのスタッフが画面から登録された
          await ctx.uow.run(ctx.tenantId, (r) =>
            r.staff.create({
              id: '00000000-0000-7000-8000-0000000000aa',
              displayName: '別',
              familyName: '別',
              givenName: '',
              email: 'other@example.com',
              altEmail: 'new@example.com',
              role: 'staff',
            }),
          );
        }
        first = false;
        return ctx.uow.run(tenantId, fn);
      },
    };
    await expect(
      importStaffSheet({ ...deps(), uow: racingUow }, admin, {
        sheets: sheets(rows),
        dryRun: false,
        fileName: null,
        planDigest: checked.planDigest,
      }),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'import_stale' });
    expect(ctx.data().staff.some((s) => s.record.email === 'new@example.com')).toBe(false);
    expect(ctx.data().importRuns).toHaveLength(0);
  });
});
