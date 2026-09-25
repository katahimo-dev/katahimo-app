import type { TestContext } from '@katahimo/core/test-utils';
import { createTestContext, fakePlaintext } from '@katahimo/core/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyReservaImport } from './plan';
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

describe('applyReservaImport(差分の適用)', () => {
  let ctx: TestContext;
  const run = (rows: ReservaCsvRow[], options: Parameters<typeof applyReservaImport>[3] = {}) =>
    applyReservaImport(ctx.deps, ctx.tenantId, rows, options);

  beforeEach(() => {
    ctx = createTestContext();
  });

  it('初回は全件作成し、import_runs と顧客データの版数を残す', async () => {
    const outcome = await run([row({ customerId: 'c1' }), row({ customerId: 'c2', givenName: '次郎' })], {
      fileName: 'Kokyaku_1.csv',
      fileVersion: '1',
    });
    expect(outcome).toMatchObject({
      status: 'applied',
      created: 2,
      updated: 0,
      archived: 0,
      customerDataVersion: 1,
    });
    expect(ctx.data().customers).toHaveLength(2);
    expect(ctx.data().importRuns).toEqual([
      expect.objectContaining({ source: 'reserva_csv', status: 'applied', fileName: 'Kokyaku_1.csv' }),
    ]);
  });

  it('同じ内容の再取込は unchanged で何も書かず、変わった顧客だけを更新する(ID を保つ)', async () => {
    await run([row({ customerId: 'c1' }), row({ customerId: 'c2', givenName: '次郎' })]);
    const ids = ctx.data().customers.map((c) => c.id);
    const outcome = await run([
      row({ customerId: 'c1', phone: '090' }),
      row({ customerId: 'c2', givenName: '次郎' }),
    ]);
    expect(outcome).toMatchObject({ status: 'applied', created: 0, updated: 1, unchanged: 1 });
    expect(ctx.data().customers.map((c) => c.id)).toEqual(ids);
  });

  it('消えた顧客はアーカイブし(import_missing)、戻ってきたら戻す', async () => {
    const rows = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => row({ customerId: id }));
    await run(rows);
    expect(await run(rows.slice(1))).toMatchObject({ status: 'applied', archived: 1 });
    const archived = ctx.data().customers.find((c) => c.archivedAt);
    expect(archived?.archiveReason).toBe('import_missing');
    expect(await run(rows)).toMatchObject({ status: 'applied', updated: 1, archived: 0 });
    expect(ctx.data().customers.every((c) => !c.archivedAt)).toBe(true);
  });

  it('消えた顧客が閾値(20%)を超えたら適用せず review_required を残す。force なら適用する', async () => {
    await run(['c1', 'c2', 'c3'].map((id) => row({ customerId: id })));
    const outcome = await run([row({ customerId: 'c1' })]);
    expect(outcome.status).toBe('review_required');
    expect(ctx.data().customers.every((c) => !c.archivedAt)).toBe(true);
    expect(ctx.data().importRuns.at(-1)?.status).toBe('review_required');
    expect(await run([row({ customerId: 'c1' })], { force: true })).toMatchObject({
      status: 'applied',
      archived: 2,
    });
  });

  it('子ども・アレルギー・緊急連絡先・住所2・位置を取り込み、個人情報は暗号化する', async () => {
    await run([
      row({
        customerId: 'c1',
        address: '東京都渋谷区道玄坂1-1',
        latLng: '35.65,139.69',
        emergencyContact: '090-1111-2222',
        emergencyContactRelation: '父',
        address2: '神奈川県横浜市青葉区1-1',
        address2StartDate: '2026/09/20',
        address2EndDate: '2026/09/30',
        familyMembers: [
          { name: '佐藤 一郎', dob: '2022/4/1', info: 'アレルギー:卵' },
          { name: '佐藤 二郎', dob: '不明', info: '' },
        ],
      }),
    ]);
    const data = ctx.data();
    expect(data.addresses.map((a) => [a.kind, a.city, a.valid])).toEqual([
      ['home', '渋谷区', { start: null, end: null }],
      ['secondary', '横浜市青葉区', { start: '2026-09-20', end: '2026-10-01' }],
    ]);
    expect(fakePlaintext(data.contacts[0]?.phoneEnc ?? null)).toBe('090-1111-2222');
    expect(data.recipients.map((r) => [r.name, r.birthDate, fakePlaintext(r.needsEnc)])).toEqual([
      ['佐藤 一郎', '2022-04-01', 'アレルギー:卵'],
      ['佐藤 二郎', null, '生年月日: 不明'],
    ]);
    expect(fakePlaintext(data.recipients[0]?.allergyEnc ?? null)).toBe('卵');
  });

  it('住所2の適用終了日が開始日より前(前日を含む)でも取込を止めず、期間なしで持って数を残す。氏名の無い行は飛ばす', async () => {
    const outcome = await run([
      row({
        customerId: 'c1',
        address2: '神奈川県横浜市青葉区1-1',
        address2StartDate: '2026/10/01',
        address2EndDate: '2026/09/30',
      }),
      row({
        customerId: 'c2',
        address2: '東京都港区1-1',
        address2StartDate: '2026/10/05',
        address2EndDate: '2026/09/01',
      }),
      row({ customerId: 'c3', familyName: '', givenName: '' }),
      row({
        customerId: 'c4',
        address2: '東京都品川区1-1',
        address2StartDate: '2026/10/01',
        address2EndDate: '2026/10/01',
      }),
    ]);
    expect(outcome).toMatchObject({
      status: 'applied',
      created: 3,
      skipped: 1,
      issues: { secondary_period_inverted: 2, missing_name: 1 },
    });
    const secondary = ctx.data().addresses.filter((a) => a.kind === 'secondary');
    expect(secondary.map((a) => a.valid)).toEqual([
      { start: null, end: null },
      { start: null, end: null },
      { start: '2026-10-01', end: '2026-10-02' },
    ]);
    expect(ctx.data().importRuns.at(-1)?.counts).toMatchObject({
      skipped: 1,
      issue_secondary_period_inverted: 2,
      issue_missing_name: 1,
    });
  });
});
