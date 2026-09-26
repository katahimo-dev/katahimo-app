import { createTestContext } from '@katahimo/core/test-utils';
import { type IntegrationCustomersRequest, integrationCustomersRequestSchema } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { ingestIntegrationCustomers } from './ingestIntegrationCustomers';

const parse = (body: IntegrationCustomersRequest) => integrationCustomersRequestSchema.parse(body).customers;

describe('ingestIntegrationCustomers(外部システムからの顧客の受け取り)', () => {
  const setup = (customerSource: 'reserva' | 'external_api' = 'external_api') => {
    const ctx = createTestContext();
    const key = { tenantId: ctx.tenantId, apiKeyId: 'key-1', name: 'k', customerSource };
    return { ctx, key };
  };

  const customer = {
    externalId: 'EXT-1',
    familyName: '佐藤',
    givenName: '花子',
    familyNameKana: 'サトウ',
    email: 'hanako@example.com',
    phone: '090-0000-0000',
    home: { addressLine: '東京都世田谷区用賀4-1-1', lat: 35.6264, lng: 139.6336, parkingArea: '有' },
    secondary: {
      addressLine: '神奈川県横浜市青葉区美しが丘1-1',
      validFrom: '2026-10-01',
      validTo: '2026-10-31',
    },
    emergencyContact: { relation: '父', phone: '080-1111-2222' },
    recipients: [{ name: '佐藤 一郎', birthDate: '2020-04-01', allergy: '卵' }],
    attributes: { member_type: '一般' },
    externalUpdatedAt: '2026-09-25T10:00:00+09:00',
  };

  it('作成 → 同じ内容は unchanged → 変えたら updated。取込元はキーのもの・import_runs と版数を残す', async () => {
    const { ctx, key } = setup();
    const first = await ingestIntegrationCustomers(ctx.deps, key, parse({ customers: [customer] }));
    expect(first).toMatchObject({
      counts: { created: 1, updated: 0, unchanged: 0, skipped: 0 },
      results: [{ externalId: 'EXT-1', outcome: 'created', issues: [] }],
      dataVersion: '1',
    });
    const data = ctx.data();
    expect(data.sourceRecords).toEqual([
      expect.objectContaining({
        source: 'external_api',
        externalId: 'EXT-1',
        lastImportRunId: first.importRunId,
      }),
    ]);
    const home = data.addresses.find((a) => a.kind === 'home');
    expect(home).toMatchObject({
      addressLine: '東京都世田谷区用賀4-1-1',
      prefecture: '東京都',
      city: '世田谷区',
      geo: { lat: 35.6264, lng: 139.6336 },
    });
    // 住所2の終了日は両端を含む(DB は半開区間)
    expect(data.addresses.find((a) => a.kind === 'secondary')?.valid).toEqual({
      start: '2026-10-01',
      end: '2026-11-01',
    });
    expect(data.importRuns).toEqual([
      expect.objectContaining({ id: first.importRunId, source: 'external_api', status: 'applied' }),
    ]);

    const second = await ingestIntegrationCustomers(ctx.deps, key, parse({ customers: [customer] }));
    expect(second).toMatchObject({ counts: { unchanged: 1 }, dataVersion: '1' });
    const third = await ingestIntegrationCustomers(
      ctx.deps,
      key,
      parse({ customers: [{ ...customer, phone: null, recipients: [] }] }),
    );
    expect(third).toMatchObject({ counts: { updated: 1 }, dataVersion: '2' });
    expect(ctx.data().customers[0]?.phone).toBeNull();
    // 子どもは消さずにアーカイブ(ID を保つ)
    expect(ctx.data().recipients[0]?.archivedAt).not.toBeNull();
    expect(ctx.appLog.byAction('integration.customers.ingested').at(-1)).toMatchObject({
      level: 'INFO',
      details: expect.objectContaining({ apiKeyId: 'key-1', updated: 1, received: 1 }),
    });
  });

  it('取込元 reserva のキーは顧客CSVと同じ顧客(RESERVA の顧客ID)を更新し、送られなかった顧客はアーカイブしない', async () => {
    const { ctx, key } = setup('reserva');
    const csvCustomer = await ctx.addCustomer('鈴木 一郎', 'R-100');
    await ctx.addCustomer('高橋 次郎', 'R-200');
    const result = await ingestIntegrationCustomers(
      ctx.deps,
      key,
      parse({
        customers: [{ externalId: 'R-100', familyName: '鈴木', givenName: '一郎', phone: '03-1234-5678' }],
      }),
    );
    expect(result.counts).toMatchObject({ updated: 1, created: 0 });
    expect(ctx.data().customers.find((c) => c.id === csvCustomer)?.phone).toBe('03-1234-5678');
    expect(ctx.data().customers.every((c) => c.archivedAt === null)).toBe(true);
  });

  it('取込元が違えば同じ顧客IDでも別の顧客(external_api は RESERVA の顧客を書き換えない)', async () => {
    const { ctx, key } = setup('external_api');
    await ctx.addCustomer('鈴木 一郎', 'R-100');
    const result = await ingestIntegrationCustomers(
      ctx.deps,
      key,
      parse({ customers: [{ externalId: 'R-100', familyName: '別人' }] }),
    );
    expect(result.counts.created).toBe(1);
    expect(ctx.data().customers).toHaveLength(2);
  });
});

describe('integrationCustomersRequestSchema', () => {
  const base = { externalId: 'A', familyName: '姓' };

  it('同じ顧客ID・501件以上・存在しない日付・住所2の期間の逆転・緯度だけは 400', () => {
    const fails = (body: unknown) => integrationCustomersRequestSchema.safeParse(body).success === false;
    expect(fails({ customers: [base, base] })).toBe(true);
    expect(
      fails({ customers: Array.from({ length: 501 }, (_, i) => ({ ...base, externalId: `A${i}` })) }),
    ).toBe(true);
    expect(fails({ customers: [] })).toBe(true);
    expect(fails({ customers: [{ ...base, recipients: [{ name: '子', birthDate: '2026-02-30' }] }] })).toBe(
      true,
    );
    expect(
      fails({
        customers: [
          { ...base, secondary: { addressLine: '住所', validFrom: '2026-10-02', validTo: '2026-10-01' } },
        ],
      }),
    ).toBe(true);
    expect(fails({ customers: [{ ...base, home: { addressLine: '住所', lat: 35 } }] })).toBe(true);
    expect(fails({ mode: 'replace', customers: [base] })).toBe(true);
    expect(fails({ customers: [{ ...base, externalId: 'A B' }] })).toBe(true);
  });

  it('省いた項目は既定値(空)にし、空文字は null にする', () => {
    const [parsed] = integrationCustomersRequestSchema.parse({
      customers: [{ ...base, memo: '', givenName: undefined }],
    }).customers;
    expect(parsed).toMatchObject({ givenName: '', memo: null, recipients: [], attributes: {} });
  });
});
