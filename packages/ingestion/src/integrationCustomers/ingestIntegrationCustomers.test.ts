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

  it('省いた項目は今の値のまま・null は空にする(部分的な送信で住所・緊急連絡先・子どもを消さない)', async () => {
    const { ctx, key } = setup();
    await ingestIntegrationCustomers(ctx.deps, key, parse({ customers: [customer] }));
    const before = ctx.data();
    // 電話番号だけを送る
    const partial = await ingestIntegrationCustomers(
      ctx.deps,
      key,
      parse({ customers: [{ externalId: 'EXT-1', familyName: '佐藤', phone: '03-9999-0000' }] }),
    );
    expect(partial).toMatchObject({ counts: { updated: 1 }, results: [{ outcome: 'updated' }] });
    const after = ctx.data();
    expect(after.customers[0]).toMatchObject({
      phone: '03-9999-0000',
      givenName: '花子',
      displayName: '佐藤 花子',
      familyNameKana: 'サトウ',
      email: 'hanako@example.com',
    });
    expect(after.addresses).toEqual(before.addresses);
    expect(after.contacts).toEqual(before.contacts);
    expect(after.recipients).toEqual(before.recipients);
    expect(after.recipients.every((r) => r.archivedAt === null)).toBe(true);
    expect(after.sourceRecords[0]).toMatchObject({
      attributes: { member_type: '一般' },
      externalUpdatedAt: new Date('2026-09-25T10:00:00+09:00'),
    });

    // 同じ値だけを送り直しても変わらない
    const again = await ingestIntegrationCustomers(
      ctx.deps,
      key,
      parse({ customers: [{ externalId: 'EXT-1', familyName: '佐藤', phone: '03-9999-0000' }] }),
    );
    expect(again.counts).toMatchObject({ unchanged: 1, updated: 0 });

    // null はまとまりごと空にする。子どもは配列で全員を置き換える
    await ingestIntegrationCustomers(
      ctx.deps,
      key,
      parse({
        customers: [
          {
            externalId: 'EXT-1',
            familyName: '佐藤',
            email: null,
            secondary: null,
            emergencyContact: null,
            externalUpdatedAt: null,
            recipients: [{ name: '佐藤 二郎' }],
          },
        ],
      }),
    );
    const cleared = ctx.data();
    expect(cleared.customers[0]).toMatchObject({ email: null, phone: '03-9999-0000' });
    expect(cleared.addresses.map((a) => a.kind)).toEqual(['home']);
    expect(cleared.contacts).toEqual([]);
    expect(cleared.sourceRecords[0]?.externalUpdatedAt).toBeNull();
    expect(
      cleared.recipients
        .map((r) => [r.name, r.archivedAt === null])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['佐藤 一郎', false],
      ['佐藤 二郎', true],
    ]);
  });

  it('新しい顧客では省いた項目は空(表示名は「姓 名」)。取込のたびにテナントの取込のロックを取る', async () => {
    const { ctx, key } = setup();
    await ingestIntegrationCustomers(
      ctx.deps,
      key,
      parse({ customers: [{ externalId: 'NEW-1', familyName: '田中' }] }),
    );
    const data = ctx.data();
    expect(data.customers[0]).toMatchObject({ displayName: '田中', givenName: '', phone: null, email: null });
    expect(data.addresses).toEqual([]);
    expect(data.recipients).toEqual([]);
    expect(data.sourceRecords[0]).toMatchObject({ attributes: {}, externalUpdatedAt: null });
    expect(ctx.db.customerImportLocks).toEqual([ctx.tenantId]);
  });

  it('適用に失敗したら全体を戻し、ERROR integration.customers.ingest_failed を残して投げる(顧客の値は残さない)', async () => {
    const { ctx, key } = setup();
    const failing = {
      ...ctx.deps,
      uow: {
        run: <T>(tenantId: string, work: (r: never) => Promise<T>) =>
          ctx.deps.uow.run(tenantId, async (r) => {
            await work(r as never);
            throw Object.assign(new Error('duplicate key value 佐藤'), { code: '23505' });
          }),
      },
    };
    await expect(
      ingestIntegrationCustomers(failing, key, parse({ customers: [customer] }), { requestId: 'req-1' }),
    ).rejects.toThrow('duplicate key');
    expect(ctx.data().customers).toEqual([]);
    const [failed] = ctx.appLog.byAction('integration.customers.ingest_failed');
    expect(failed).toMatchObject({
      level: 'ERROR',
      requestId: 'req-1',
      details: expect.objectContaining({ apiKeyId: 'key-1', received: 1, error: 'db:23505' }),
    });
    expect(JSON.stringify(failed)).not.toContain('佐藤');
    expect(ctx.appLog.byAction('integration.customers.ingested')).toEqual([]);
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

  it('省いた項目は省いたまま(今の値を保つ)、空文字は null にする', () => {
    const [parsed] = integrationCustomersRequestSchema.parse({
      customers: [{ ...base, memo: '', phone: null, givenName: undefined }],
    }).customers;
    expect(parsed).toMatchObject({ memo: null, phone: null });
    for (const key of ['givenName', 'recipients', 'attributes', 'home', 'email', 'displayName'] as const) {
      expect(parsed?.[key], key).toBeUndefined();
    }
  });
});
