import { beforeEach, describe, expect, it } from 'vitest';
import type { CustomerDeps } from './customers';
import {
  createCustomer,
  deactivateCustomer,
  getCustomerDetail,
  listCustomers,
  searchCustomersByFamilyName,
  updateCustomer,
} from './customers';
import { FakeCryptoPort, FakeCustomerRepository, FakeFamilyMemberRepository } from './testDoubles';

describe('createCustomer / searchCustomersByFamilyName', () => {
  let deps: CustomerDeps;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    deps = {
      customers: new FakeCustomerRepository(),
      familyMembers: new FakeFamilyMemberRepository(),
      crypto: new FakeCryptoPort(),
    };
  });

  it('登録した顧客を苗字の完全一致で検索できる(登録時と検索時の正規化が一致する)', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤 花子', phone: '090-1111-2222', city: '渋谷区' });
    await createCustomer(deps, { tenantId, name: '佐藤 次郎', phone: '090-3333-4444', city: '新宿区' });
    await createCustomer(deps, { tenantId, name: '鈴木 三郎' });

    const result = await searchCustomersByFamilyName(deps, tenantId, '佐藤');
    expect(result.map((c) => c.name).sort()).toEqual(['佐藤 次郎', '佐藤 花子']);
  });

  it('全角スペース区切りで登録した氏名も、検索側の入力(前後空白付き)と正しく一致する', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤　花子' });

    const result = await searchCustomersByFamilyName(deps, tenantId, '  佐藤  ');
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('佐藤　花子');
  });

  it('一致する苗字が無ければ空配列を返す', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤 花子' });
    expect(await searchCustomersByFamilyName(deps, tenantId, '田中')).toEqual([]);
  });

  it('電話・市区町村は復号された値で返る', async () => {
    await createCustomer(deps, { tenantId, name: '佐藤 花子', phone: '090-1111-2222', city: '渋谷区' });
    const [result] = await searchCustomersByFamilyName(deps, tenantId, '佐藤');
    expect(result?.phone).toBe('090-1111-2222');
    expect(result?.city).toBe('渋谷区');
  });

  it('他テナントの同姓顧客はヒットしない(テナント分離)', async () => {
    await createCustomer(deps, { tenantId: 'tenant-2', name: '佐藤 一郎' });
    expect(await searchCustomersByFamilyName(deps, tenantId, '佐藤')).toEqual([]);
  });

  it('世帯構成員(子ども等)を登録すると、詳細取得で復号された状態で返る', async () => {
    const created = await createCustomer(deps, {
      tenantId,
      name: '佐藤 花子',
      externalSource: 'reserva',
      externalId: 'cust-001',
      email: 'hanako@example.com',
      memo: '第一子アレルギー注意',
      familyMembers: [
        { name: '佐藤 太郎', dob: '2019/1/19', info: '保育園児 卵アレルギー' },
        { name: '佐藤 次子', dob: '2021/6/20', info: '' },
      ],
    });

    const detail = await getCustomerDetail(deps, tenantId, created.id);
    expect(detail?.email).toBe('hanako@example.com');
    expect(detail?.memo).toBe('第一子アレルギー注意');
    expect(detail?.externalSource).toBe('reserva');
    expect(detail?.externalId).toBe('cust-001');
    expect(detail?.familyMembers).toEqual([
      { id: expect.any(String), name: '佐藤 太郎', dob: '2019/1/19', info: '保育園児 卵アレルギー' },
      { id: expect.any(String), name: '佐藤 次子', dob: '2021/6/20', info: null },
    ]);
  });

  it('updateCustomerでfamilyMembersを渡すと全件入れ替わる', async () => {
    const created = await createCustomer(deps, {
      tenantId,
      name: '佐藤 花子',
      familyMembers: [{ name: '佐藤 太郎', dob: '2019/1/19' }],
    });

    await updateCustomer(deps, tenantId, created.id, {
      tenantId,
      name: '佐藤 花子',
      familyMembers: [
        { name: '佐藤 太郎', dob: '2019/1/19' },
        { name: '佐藤 三郎', dob: '2023/4/1' },
      ],
    });

    const detail = await getCustomerDetail(deps, tenantId, created.id);
    expect(detail?.familyMembers.map((f) => f.name).sort()).toEqual(['佐藤 三郎', '佐藤 太郎']);
  });

  it('deactivateCustomerでソフトデリートされ、listActiveExternalIdsから外れる', async () => {
    const created = await createCustomer(deps, {
      tenantId,
      name: '佐藤 花子',
      externalSource: 'reserva',
      externalId: 'cust-001',
    });

    expect(await deps.customers.listActiveExternalIds(tenantId, 'reserva')).toEqual(['cust-001']);

    await deactivateCustomer(deps, tenantId, created.id);

    expect(await deps.customers.listActiveExternalIds(tenantId, 'reserva')).toEqual([]);
    const detail = await getCustomerDetail(deps, tenantId, created.id);
    expect(detail?.deactivatedAt).not.toBeNull();
  });

  it('listCustomersは有効な顧客全件を復号して返し、地区の重複無し・五十音順一覧も返す', async () => {
    const deactivated = await createCustomer(deps, { tenantId, name: '田中 一郎', city: '港区' });
    await createCustomer(deps, { tenantId, name: '佐藤 花子', city: '渋谷区' });
    await createCustomer(deps, { tenantId, name: '鈴木 三郎', city: '渋谷区' });
    await createCustomer(deps, { tenantId, name: '高橋 四郎' });
    await deactivateCustomer(deps, tenantId, deactivated.id);

    const result = await listCustomers(deps, tenantId);

    expect(result.customers.map((c) => c.name).sort()).toEqual(['佐藤 花子', '鈴木 三郎', '高橋 四郎']);
    expect(result.cities).toEqual(['渋谷区']);
  });
});
