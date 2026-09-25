import {
  FakeCryptoPort,
  FakeCustomerRepository,
  FakeFamilyMemberRepository,
} from '@katahimo/core/test-utils';
import type { CustomerDeps } from '@katahimo/core/usecases';
import { createCustomer } from '@katahimo/core/usecases';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyReservaImportPlan, planReservaImport } from './plan';
import type { ReservaCsvRow } from './types';

function row(overrides: Partial<ReservaCsvRow>): ReservaCsvRow {
  return {
    customerId: 'cust-1',
    familyName: '佐藤',
    givenName: '花子',
    familyNameKana: '',
    givenNameKana: '',
    email: '',
    countryCode: '',
    phone: '',
    memberType: '',
    memberStatus: '',
    paymentMethod: '',
    paymentStatus: '',
    memo: '',
    registeredAt: null,
    externalLastUpdatedAt: null,
    gender: '',
    ageBracket: '',
    address: '',
    parkingArea: '',
    parkingDetail: '',
    emergencyContact: '',
    emergencyContactRelation: '',
    evacuationSite: '',
    familyInfoRaw: '',
    familyMembers: [],
    benefitMemberId: '',
    address2: '',
    address2StartDate: '',
    address2EndDate: '',
    latLng: '',
    ...overrides,
  };
}

describe('planReservaImport / applyReservaImportPlan', () => {
  let deps: CustomerDeps;
  const tenantId = 'tenant-1';

  beforeEach(() => {
    deps = {
      customers: new FakeCustomerRepository(),
      familyMembers: new FakeFamilyMemberRepository(),
      crypto: new FakeCryptoPort(),
    };
  });

  it('初回取込は既存0件なので全件createになり、レビュー不要', async () => {
    const rows = [row({ customerId: 'c1' }), row({ customerId: 'c2', familyName: '鈴木' })];
    const plan = await planReservaImport(deps.customers, tenantId, rows);

    expect(plan.toCreate).toHaveLength(2);
    expect(plan.toUpdate).toHaveLength(0);
    expect(plan.toDeactivateExternalIds).toHaveLength(0);
    expect(plan.requiresReview).toBe(false);
  });

  it('外部IDが既存と一致する行はupdate、CSVに存在しなくなった外部IDはdeactivate対象になる', async () => {
    // 消失率を閾値未満に保つため、十分な数の既存顧客を用意してから検証する
    // (このテストの主眼は分類ロジックであり、閾値の安全装置は別テストで検証する)
    const initialRows = Array.from({ length: 10 }, (_, i) => row({ customerId: `c${i}` }));
    await applyReservaImportPlan(
      deps,
      tenantId,
      await planReservaImport(deps.customers, tenantId, initialRows),
    );

    // 2回目の取込では c0 が更新対象・c9 が消失(取込データに無い)対象になる
    const secondRows = initialRows
      .slice(0, 9)
      .map((r) => (r.customerId === 'c0' ? { ...r, memo: '更新後メモ' } : r));
    const plan = await planReservaImport(deps.customers, tenantId, secondRows);
    expect(plan.toUpdate.map((r) => r.customerId)).toEqual(expect.arrayContaining(['c0']));
    expect(plan.toDeactivateExternalIds).toEqual(['c9']);
  });

  it('既存件数に対して変更(更新+消失)が閾値を超えるとrequiresReview=trueになり、適用は拒否される', async () => {
    // 既存10件作る
    const initialRows = Array.from({ length: 10 }, (_, i) => row({ customerId: `c${i}` }));
    await applyReservaImportPlan(
      deps,
      tenantId,
      await planReservaImport(deps.customers, tenantId, initialRows),
    );

    // 3件しか含まれない取込 = 7件が消失扱いになり、閾値(既定20%)を超える
    const plan = await planReservaImport(deps.customers, tenantId, initialRows.slice(0, 3));
    expect(plan.requiresReview).toBe(true);
    await expect(applyReservaImportPlan(deps, tenantId, plan)).rejects.toThrow(/閾値/);
  });

  it('requiresReview=trueでもforce:trueを指定すれば適用できる', async () => {
    const initialRows = Array.from({ length: 10 }, (_, i) => row({ customerId: `c${i}` }));
    await applyReservaImportPlan(
      deps,
      tenantId,
      await planReservaImport(deps.customers, tenantId, initialRows),
    );

    const plan = await planReservaImport(deps.customers, tenantId, initialRows.slice(0, 3));
    const result = await applyReservaImportPlan(deps, tenantId, plan, { force: true });
    expect(result.deactivated).toBe(7);
  });

  it('世帯構成員(子ども)を含む行を適用すると、family_membersに反映される', async () => {
    const rows = [
      row({
        customerId: 'c1',
        familyMembers: [{ name: '佐藤 太郎', dob: '2019/1/19', info: '保育園児' }],
      }),
    ];
    await applyReservaImportPlan(deps, tenantId, await planReservaImport(deps.customers, tenantId, rows));

    const created = await deps.customers.findByExternalId(tenantId, 'reserva', 'c1');
    if (!created) throw new Error('customer not found');
    const members = await deps.familyMembers.listByCustomerId(tenantId, created.id);
    expect(members).toHaveLength(1);
    const firstMember = members[0];
    if (!firstMember) throw new Error('family member not found');
    expect(await deps.crypto.decrypt(tenantId, firstMember.name)).toBe('佐藤 太郎');
  });

  it('手動登録済みの顧客(externalSourceが無い)は取込の既存件数にカウントされない', async () => {
    await createCustomer(deps, { tenantId, name: '手動 太郎' });

    const plan = await planReservaImport(deps.customers, tenantId, [row({ customerId: 'c1' })]);
    expect(plan.stats.existingActiveCount).toBe(0);
    expect(plan.requiresReview).toBe(false);
  });
});
