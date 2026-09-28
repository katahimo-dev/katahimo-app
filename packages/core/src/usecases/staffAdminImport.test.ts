import { beforeEach, describe, expect, it } from 'vitest';
import type { ImportCell } from '../domain';
import type { LatLng, MapsPort } from '../ports/maps';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { Actor } from './requestMeta';
import { createStaffByAdmin } from './staffAdmin';
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
  const run = (rows: ImportCell[][], dryRun: boolean) =>
    importStaffSheet(deps(), admin, { sheets: sheets(rows), dryRun, fileName: 'staff.xlsx' });

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
    expect(log).toMatchObject({ level: 'SECURITY', details: { created: 1, updated: 1, warnings: 1 } });
    expect(JSON.stringify(log?.details)).not.toContain('hanako');
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
      }),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'import_stale' });
    expect(ctx.data().staff.some((s) => s.record.email === 'new@example.com')).toBe(false);
    expect(ctx.data().importRuns).toHaveLength(0);
  });
});
