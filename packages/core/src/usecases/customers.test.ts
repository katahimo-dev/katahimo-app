import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomerSnapshot } from './customers';
import {
  applyCustomerSnapshot,
  getCustomerDetail,
  listCustomers,
  searchCustomersByFamilyName,
} from './customers';
import type { TestContext } from './testContext';
import { createTestContext } from './testContext';

function snapshot(overrides: Partial<CustomerSnapshot> = {}): CustomerSnapshot {
  return {
    source: 'reserva',
    externalId: 'R-001',
    displayName: '佐藤 花子',
    familyName: '佐藤',
    givenName: '花子',
    phone: '090-1111-2222',
    memo: '玄関は裏口',
    attributes: { member_type: '一般' },
    home: { addressLine: '渋谷1-2-3', city: '渋谷区', latLng: '35.66,139.70' },
    secondary: null,
    emergencyContact: { relation: '父', phone: '090-9999-0000' },
    recipients: [
      { name: '佐藤 一郎', birthDate: '2022-04-01', allergy: '卵' },
      { name: '佐藤 二郎', birthDate: '2024-01-15', allergy: null },
    ],
    ...overrides,
  };
}

describe('applyCustomerSnapshot(取込の差分適用)', () => {
  let ctx: TestContext;
  const apply = (s: CustomerSnapshot) =>
    ctx.uow.run(ctx.tenantId, (r) => applyCustomerSnapshot({ runId: null }, r, s, ctx.clock.now));

  beforeEach(() => {
    ctx = createTestContext();
  });

  it('初回は作成し、同じ内容の再取込は unchanged(何も書かない)', async () => {
    expect(await apply(snapshot())).toBe('created');
    const before = structuredClone(ctx.data());
    expect(await apply(snapshot())).toBe('unchanged');
    expect(ctx.data().customers[0]?.rowVersion).toBe(before.customers[0]?.rowVersion);
    expect(ctx.data().recipients.map((r) => r.id)).toEqual(before.recipients.map((r) => r.id));
  });

  it('属性のキーの順番が違うだけなら unchanged(jsonb はキーの順番を保たない)', async () => {
    await apply(snapshot({ attributes: { member_type: '一般', gender: '女性' } }));
    expect(await apply(snapshot({ attributes: { gender: '女性', member_type: '一般' } }))).toBe('unchanged');
  });

  it('緯度経度は数値で持ち、読めない値は緯度経度なし(区画も無し)にする。表記はそのまま残す', async () => {
    await apply(snapshot());
    expect(ctx.data().addresses[0]).toMatchObject({
      geo: { lat: 35.66, lng: 139.7 },
      latLngText: '35.66,139.70',
      geoCell: 'xn76fg',
    });
    const home = (latLng: string) => snapshot({ home: { addressLine: '渋谷1-2-3', city: '渋谷区', latLng } });
    expect(await apply(home('abc'))).toBe('updated');
    expect(ctx.data().addresses[0]).toMatchObject({ geo: null, latLngText: 'abc', geoCell: null });
    // 片方が空の値を 0 として持たない
    for (const latLng of ['35.68,', ' , ']) {
      await apply(home(latLng));
      expect(ctx.data().addresses[0]?.geo).toBeNull();
    }
    await apply(home('35.68°,139.76'));
    expect(ctx.data().addresses[0]?.geo).toEqual({ lat: 35.68, lng: 139.76 });
    await apply(home('35.6810，139.7670'));
    expect(ctx.data().addresses[0]?.geo).toEqual({ lat: 35.681, lng: 139.767 });
  });

  it('詳細の緯度・経度は取込元の表記のまま返す(GAS版と同じ)', async () => {
    await apply(
      snapshot({ home: { addressLine: '渋谷1-2-3', city: '渋谷区', latLng: '35.6810, 139.7670' } }),
    );
    const { actor } = await ctx.addStaff('山田 太郎', 'taro@example.com');
    const id = ctx.data().customers[0]?.id ?? '';
    expect((await getCustomerDetail(ctx.deps, actor, id)).latLng).toBe('35.6810, 139.7670');
  });

  it('変わった子どもだけを更新し、ID を保つ。取込元から消えた子どもはアーカイブする', async () => {
    await apply(snapshot());
    const [ichiro, jiro] = ctx.data().recipients;
    expect(
      await apply(
        snapshot({ recipients: [{ name: '佐藤 一郎', birthDate: '2022-04-01', allergy: '卵・小麦' }] }),
      ),
    ).toBe('updated');
    const after = ctx.data().recipients;
    expect(after.find((r) => r.id === ichiro?.id)?.archivedAt).toBeNull();
    expect(after.find((r) => r.id === ichiro?.id)?.allergy).toBe('卵・小麦');
    expect(after.find((r) => r.id === jiro?.id)?.archivedAt).toEqual(ctx.clock.now);
  });

  it('アーカイブ済みの顧客が取込元に戻ったら戻す', async () => {
    await apply(snapshot());
    const id = ctx.data().customers[0]?.id ?? '';
    await ctx.uow.run(ctx.tenantId, (r) => r.customers.archive(id, 'import_missing', ctx.clock.now));
    expect(await apply(snapshot())).toBe('updated');
    expect(ctx.data().customers[0]?.archivedAt).toBeNull();
  });
});

describe('顧客の一覧・検索・詳細', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = createTestContext();
    await ctx.uow.run(ctx.tenantId, async (r) => {
      await applyCustomerSnapshot({ runId: null }, r, snapshot(), ctx.clock.now);
      await applyCustomerSnapshot(
        { runId: null },
        r,
        snapshot({
          externalId: 'R-002',
          displayName: '鈴木 三郎',
          familyName: '鈴木',
          givenName: '三郎',
          home: { addressLine: '新宿1-1', city: '新宿区' },
          recipients: [],
        }),
        ctx.clock.now,
      );
    });
  });

  it('一覧と地区の一覧を返す', async () => {
    const result = await listCustomers(ctx.deps, ctx.tenantId);
    expect(result.customers.map((c) => c.displayName).sort()).toEqual(['佐藤 花子', '鈴木 三郎']);
    expect([...result.cities].sort()).toEqual(['新宿区', '渋谷区'].sort());
  });

  it('苗字の完全一致(前後の空白・全角は正規化)で検索できる', async () => {
    expect(
      (await searchCustomersByFamilyName(ctx.deps, ctx.tenantId, ' 佐藤 ')).map((c) => c.displayName),
    ).toEqual(['佐藤 花子']);
    expect(await searchCustomersByFamilyName(ctx.deps, ctx.tenantId, '田中')).toEqual([]);
  });

  it('詳細は子ども・アレルギー・緊急連絡先を含めて返す', async () => {
    const { actor } = await ctx.addStaff('山田 太郎', 'taro@example.com');
    const id = ctx.data().customers.find((c) => c.displayName === '佐藤 花子')?.id ?? '';
    const detail = await getCustomerDetail(ctx.deps, actor, id);
    expect(detail).toMatchObject({
      name: '佐藤 花子',
      externalId: 'R-001',
      memo: '玄関は裏口',
      emergencyContact: '090-9999-0000',
      emergencyContactRelation: '父',
      latLng: '35.66,139.70',
      memberType: '一般',
      archivedAt: null,
    });
    expect(detail.familyMembers).toEqual([
      expect.objectContaining({ name: '佐藤 一郎', dob: '2022/4/1', allergy: '卵' }),
      expect.objectContaining({ name: '佐藤 二郎', dob: '2024/1/15', allergy: null }),
    ]);
  });

  it('他テナントの顧客は見えない(not_found)', async () => {
    const other = ctx.db.addTenant({ slug: 'other' });
    const id = ctx.data().customers[0]?.id ?? '';
    await expect(
      getCustomerDetail(ctx.deps, { tenantId: other.id, staffId: 'x', role: 'admin' }, id),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
