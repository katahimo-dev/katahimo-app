import { readFileSync } from 'node:fs';
import {
  FakeAppLogPort,
  FakeCryptoPort,
  FakeCustomerCsvSource,
  FakeCustomerImportStateRepository,
  FakeCustomerRepository,
  FakeFamilyMemberRepository,
} from '@katahimo/core/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { type CustomerCsvImportDeps, importLatestCustomerCsv } from './importLatestCustomerCsv';

const FIXTURE = readFileSync(
  new URL('../reservaCsv/__fixtures__/Kokyaku_202601191958_1_dummy.csv', import.meta.url),
);
const tenant = { id: 'tenant-1', slug: 'demo' };

describe('importLatestCustomerCsv(GAS版 checkAndImportLatestCsv)', () => {
  let deps: CustomerCsvImportDeps;
  let source: FakeCustomerCsvSource;
  let appLog: FakeAppLogPort;
  let customers: FakeCustomerRepository;

  beforeEach(() => {
    source = new FakeCustomerCsvSource();
    appLog = new FakeAppLogPort();
    customers = new FakeCustomerRepository();
    deps = {
      customers,
      familyMembers: new FakeFamilyMemberRepository(),
      crypto: new FakeCryptoPort(),
      csvSource: source,
      importState: new FakeCustomerImportStateRepository(),
      appLog,
      now: () => new Date('2026-09-25T18:00:00Z'),
    };
  });

  it('取込元が無いテナントは not_configured、該当ファイルが無ければ no_files', async () => {
    expect((await importLatestCustomerCsv(deps, { tenant })).status).toBe('not_configured');
    source.put('demo', 'memo.txt', Buffer.from(''));
    expect((await importLatestCustomerCsv(deps, { tenant })).status).toBe('no_files');
  });

  it('最新のCSVを取り込んで版と dataVersion を進め、2回目は何もしない(up_to_date)', async () => {
    source.put('demo', 'Kokyaku_202601010000_1.csv', Buffer.from('壊れたCSV'));
    source.put('demo', 'Kokyaku_202601191958_1.csv', FIXTURE);

    const first = await importLatestCustomerCsv(deps, { tenant });
    expect(first).toMatchObject({
      status: 'imported',
      fileName: 'Kokyaku_202601191958_1.csv',
      version: '202601191958',
      dataVersion: '1',
    });
    expect(first.stats?.created).toBeGreaterThan(0);
    expect((await customers.listActive(tenant.id)).length).toBe(first.stats?.created);
    expect(appLog.byAction('customer_csv.imported')).toEqual([
      expect.objectContaining({ level: 'INFO', details: expect.objectContaining({ triggeredBy: 'system' }) }),
    ]);

    const second = await importLatestCustomerCsv(deps, { tenant });
    expect(second).toMatchObject({ status: 'up_to_date', dataVersion: '1' });
  });

  it('force なら取込済みの版でも取り込み直し、操作した管理者を記録する', async () => {
    source.put('demo', 'Kokyaku_202601191958_1.csv', FIXTURE);
    await importLatestCustomerCsv(deps, { tenant });
    const forced = await importLatestCustomerCsv(deps, {
      tenant,
      force: true,
      actor: { staffId: 'admin-1', name: '管理者 太郎' },
    });
    expect(forced).toMatchObject({ status: 'imported', dataVersion: '2', stats: { created: 0 } });
    expect(appLog.byAction('customer_csv.imported').at(-1)).toMatchObject({
      actorStaffId: 'admin-1',
      details: expect.objectContaining({ force: true, triggeredBy: '管理者 太郎' }),
    });
  });

  it('CSVから消えた顧客が多すぎる場合は適用せず review_required(版も進めない)', async () => {
    source.put('demo', 'Kokyaku_202601191958_1.csv', FIXTURE);
    const first = await importLatestCustomerCsv(deps, { tenant });
    const count = first.stats?.created ?? 0;
    // 新しい版として、顧客が1件しか無いCSVが届いた
    const header = FIXTURE.toString('utf16le').split(/\r?\n/)[0] ?? '';
    const oneRow = ['new-customer-1', '新規', '顧客'].join('\t');
    source.put('demo', 'Kokyaku_202602010000_1.csv', Buffer.from(`${header}\r\n${oneRow}\r\n`, 'utf16le'));

    const result = await importLatestCustomerCsv(deps, { tenant });
    expect(result.status, result.message).toBe('review_required');
    expect(result.dataVersion).toBe('1');
    expect((await customers.listActive(tenant.id)).length).toBe(count);
    expect(appLog.byAction('customer_csv.import_review_required')).toHaveLength(1);
  });

  it('読み込みに失敗したら failed で ERROR ログを残す', async () => {
    source.put('demo', 'Kokyaku_202601191958_1.csv', Buffer.from('顧客ID\n'));
    const result = await importLatestCustomerCsv(deps, { tenant });
    expect(result.status).toBe('failed');
    expect(appLog.byAction('customer_csv.import_failed')).toEqual([
      expect.objectContaining({ level: 'ERROR' }),
    ]);
  });
});
