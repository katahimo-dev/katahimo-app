import { readFileSync } from 'node:fs';
import type { TestContext } from '@katahimo/core/test-utils';
import { createTestContext, type FakeAppLogPort, FakeCustomerCsvSource } from '@katahimo/core/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { type CustomerCsvImportDeps, importLatestCustomerCsv } from './importLatestCustomerCsv';

/** テストのテナントの取込元の Drive のフォルダ(platform.tenants.customer_import_settings)。 */
const FOLDER = 'drive-folder-demo-0001';
const FIXTURE = readFileSync(
  new URL('../reservaCsv/__fixtures__/Kokyaku_202601191958_1_dummy.csv', import.meta.url),
);

describe('importLatestCustomerCsv(GAS版 checkAndImportLatestCsv)', () => {
  let deps: CustomerCsvImportDeps;
  let source: FakeCustomerCsvSource;
  let appLog: FakeAppLogPort;
  let ctx: TestContext;
  let tenant: { id: string; slug: string };
  const activeCustomers = () => ctx.data().customers.filter((c) => !c.archivedAt);

  beforeEach(() => {
    ctx = createTestContext({ now: '2026-09-25T18:00:00Z' });
    tenant = { id: ctx.tenantId, slug: 'demo' };
    source = new FakeCustomerCsvSource();
    appLog = ctx.appLog;
    deps = { ...ctx.deps, csvSource: source };
    ctx.db.customerImportSettings.set(ctx.tenantId, { provider: 'reserva_csv', driveFolderId: FOLDER });
  });

  it('取込元の設定が無いテナントは not_configured、該当ファイルが無ければ no_files', async () => {
    ctx.db.customerImportSettings.delete(ctx.tenantId);
    // 別のテナントのフォルダにファイルがあっても、設定の無いテナントは読まない
    source.put(FOLDER, 'Kokyaku_202601191958_1.csv', FIXTURE);
    expect((await importLatestCustomerCsv(deps, { tenant })).status).toBe('not_configured');
    ctx.db.customerImportSettings.set(ctx.tenantId, {
      provider: 'reserva_csv',
      driveFolderId: 'drive-folder-empty-01',
    });
    source.put('drive-folder-empty-01', 'memo.txt', Buffer.from(''));
    expect((await importLatestCustomerCsv(deps, { tenant })).status).toBe('no_files');
  });

  it('最新のCSVを取り込んで版と dataVersion を進め、2回目は何もしない(up_to_date)', async () => {
    source.put(FOLDER, 'Kokyaku_202601010000_1.csv', Buffer.from('壊れたCSV'));
    source.put(FOLDER, 'Kokyaku_202601191958_1.csv', FIXTURE);

    const first = await importLatestCustomerCsv(deps, { tenant });
    expect(first).toMatchObject({
      status: 'imported',
      fileName: 'Kokyaku_202601191958_1.csv',
      version: '202601191958',
      dataVersion: '1',
    });
    expect(first.stats?.created).toBeGreaterThan(0);
    expect(activeCustomers().length).toBe(first.stats?.created);
    expect(appLog.byAction('customer_csv.imported')).toEqual([
      expect.objectContaining({ level: 'INFO', details: expect.objectContaining({ triggeredBy: 'system' }) }),
    ]);

    const second = await importLatestCustomerCsv(deps, { tenant });
    expect(second).toMatchObject({ status: 'up_to_date', dataVersion: '1' });
  });

  it('force なら取込済みの版でも取り込み直し、操作した管理者を記録する', async () => {
    source.put(FOLDER, 'Kokyaku_202601191958_1.csv', FIXTURE);
    await importLatestCustomerCsv(deps, { tenant });
    const forced = await importLatestCustomerCsv(deps, {
      tenant,
      force: true,
      actor: { staffId: '00000000-0000-7000-8000-0000000000aa', name: '管理者 太郎' },
    });
    expect(forced).toMatchObject({ status: 'imported', dataVersion: '1', stats: { created: 0 } });
    // 内容が同じなら版数は上げない(画面・予定計算のキャッシュを無駄に読み直させない)
    expect(appLog.byAction('customer_csv.imported').at(-1)).toMatchObject({
      actorStaffId: '00000000-0000-7000-8000-0000000000aa',
      details: expect.objectContaining({ force: true, triggeredBy: '管理者 太郎' }),
    });
  });

  it('CSVから消えた顧客が多すぎる場合は適用せず review_required(版も進めない)', async () => {
    source.put(FOLDER, 'Kokyaku_202601191958_1.csv', FIXTURE);
    const first = await importLatestCustomerCsv(deps, { tenant });
    const count = first.stats?.created ?? 0;
    // 新しい版として、顧客が1件しか無いCSVが届いた
    const header = FIXTURE.toString('utf16le').split(/\r?\n/)[0] ?? '';
    const oneRow = ['new-customer-1', '新規', '顧客'].join('\t');
    source.put(FOLDER, 'Kokyaku_202602010000_1.csv', Buffer.from(`${header}\r\n${oneRow}\r\n`, 'utf16le'));

    const result = await importLatestCustomerCsv(deps, { tenant });
    expect(result.status, result.message).toBe('review_required');
    expect(result.dataVersion).toBe('1');
    expect(activeCustomers().length).toBe(count);
    expect(appLog.byAction('customer_csv.import_review_required')).toHaveLength(1);
  });

  it('読み込みに失敗したら failed で ERROR ログを残す', async () => {
    source.put(FOLDER, 'Kokyaku_202601191958_1.csv', Buffer.from('顧客ID\n'));
    const result = await importLatestCustomerCsv(deps, { tenant });
    expect(result.status).toBe('failed');
    expect(appLog.byAction('customer_csv.import_failed')).toEqual([
      expect.objectContaining({ level: 'ERROR' }),
    ]);
  });
});
