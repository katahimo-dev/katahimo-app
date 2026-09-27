import type { LegacyDriveFile, LegacyDriveFilePort, LegacyImportedRow } from '@katahimo/core/ports';
import { FakeAppLogPort, FakeStoragePort } from '@katahimo/core/test-utils';
import {
  applyCustomerSnapshot,
  importLegacyReceiptRows,
  importLegacyReportRows,
  type LegacyDailyReportRow,
  type LegacyReceiptRow,
} from '@katahimo/core/usecases';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withTenant } from '../client';
import { pgErrorOf } from '../errors';
import { connect } from './testDb';

/**
 * GAS版のスプレッドシートからの移行の取込を実際の DB で確かめる: 取り込んだ行と記録の対応(legacy_imported_rows)の
 * 主キー(同じ行を2回取り込まない)・行の指す先の CHECK・テナントの分離(RLS)・アプリの権限(消せない)と、取込を2回
 * 流しても記録・領収書が増えないこと(katahimo_app の接続で動く運用担当者の CLI と同じ)。
 */
const { app, uow, createTenant, createStaff } = connect();

const sqlState = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => pgErrorOf(error)?.code ?? String(error),
  );

async function setup() {
  const tenantId = await createTenant('li');
  const staffId = await uow.run(tenantId, (r) => createStaff(r, '山田 太郎'));
  await uow.run(tenantId, (r) =>
    applyCustomerSnapshot(
      { runId: null },
      r,
      {
        source: 'reserva',
        externalId: '1001',
        displayName: '佐藤 花子',
        familyName: '佐藤',
        givenName: '花子',
        attributes: {},
        home: null,
        secondary: null,
        emergencyContact: null,
        recipients: [],
      },
      new Date(),
    ),
  );
  const appLog = new FakeAppLogPort();
  return { tenantId, staffId, deps: { uow, appLog } };
}

function dailyRow(inputText: string): LegacyDailyReportRow {
  return {
    source: 'gas_daily_report',
    rowNumber: 2,
    sourceKey: JSON.stringify(['2026/09/05 09:00:00', '山田太郎', '1001', '09:00']),
    timestamp: '2026/09/05 09:00:00',
    staffName: '山田 太郎',
    customerExternalId: '1001',
    content: { startTime: '09:00', endTime: '12:00', inputText, internalText: '', customerText: '' },
    riskRating: 4,
    esRating: null,
  };
}

const reportInput = (rows: LegacyDailyReportRow[]) => ({
  spreadsheetId: '1SpreadsheetIdForIntegrationTest0000',
  daily: { rows, issues: [], blankRowCount: 0 },
  accident: { rows: [], issues: [], blankRowCount: 0 },
});

const count = async (tenantId: string, table: 'care_records' | 'care_record_revisions' | 'receipts') =>
  Number(
    (
      (await withTenant(app, tenantId, (tx) =>
        tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`),
      )) as unknown as { n: number }[]
    )[0]?.n,
  );

describe('GAS版の日報・事故報告の取込(実際の DB)', () => {
  it('2回流しても記録は増えず、シートで直された行は記録を直して変更前を履歴に残す', async () => {
    const { tenantId, deps } = await setup();
    const first = await importLegacyReportRows(deps, tenantId, reportInput([dailyRow('メモ')]));
    expect(first.counts.gas_daily_report).toMatchObject({ created: 1 });
    const again = await importLegacyReportRows(deps, tenantId, reportInput([dailyRow('メモ')]));
    expect(again.counts.gas_daily_report).toMatchObject({ created: 0, unchanged: 1 });
    expect(await count(tenantId, 'care_records')).toBe(1);

    const edited = await importLegacyReportRows(deps, tenantId, reportInput([dailyRow('直したメモ')]));
    expect(edited.counts.gas_daily_report).toMatchObject({ updated: 1 });
    expect(await count(tenantId, 'care_records')).toBe(1);
    expect(await count(tenantId, 'care_record_revisions')).toBe(1);
    const runs = (await withTenant(app, tenantId, (tx) =>
      tx.execute(sql`select source, status, file_name from import_runs order by started_at`),
    )) as unknown as { source: string; status: string; file_name: string }[];
    expect(runs.map((r) => [r.source, r.status])).toEqual([
      ['legacy_reports_sheet', 'applied'],
      ['legacy_reports_sheet', 'applied'],
      ['legacy_reports_sheet', 'applied'],
    ]);
    // ミラーは積まない
    const outbox = (await withTenant(app, tenantId, (tx) =>
      tx.execute(sql`select count(*)::int as n from outbox_messages`),
    )) as unknown as { n: number }[];
    expect(outbox[0]?.n).toBe(0);
  });

  it('確定済みの記録はシートが変わっても直さない(KH002 を踏まずに skipped)', async () => {
    const { tenantId, deps } = await setup();
    await importLegacyReportRows(deps, tenantId, reportInput([dailyRow('メモ')]));
    await withTenant(app, tenantId, (tx) => tx.execute(sql`update care_records set status = 'locked'`));
    const result = await importLegacyReportRows(deps, tenantId, reportInput([dailyRow('直したメモ')]));
    expect(result.counts.gas_daily_report).toMatchObject({ skipped: 1, updated: 0 });
    expect(result.issues).toEqual([{ source: 'gas_daily_report', rowNumber: 2, reason: 'locked' }]);
  });
});

/** 画像1枚だけがある Drive。 */
class OneImageDrive implements LegacyDriveFilePort {
  async getFile(fileId: string): Promise<LegacyDriveFile | null> {
    return { id: fileId, mimeType: 'image/png', byteSize: 8, trashed: false };
  }
  async download(): Promise<Uint8Array> {
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
}

const receiptRow = (fileId: string): LegacyReceiptRow => ({
  source: 'gas_receipt',
  rowNumber: 2,
  sourceKey: fileId,
  timestamp: '2026/09/05 12:30:00',
  staffName: '山田 太郎',
  customerExternalId: '1001',
  customerName: '佐藤様',
  amount: '1200',
  storeName: 'コンビニ',
  handoffText: '申し送り',
});

describe('GAS版の領収書の取込(実際の DB)', () => {
  it('2回流しても領収書は増えない(画像の Drive のファイル ID で突き合わせる)', async () => {
    const { tenantId, deps } = await setup();
    const storage = new FakeStoragePort();
    const receiptDeps = { ...deps, storage, drive: new OneImageDrive() };
    const input = {
      spreadsheetId: '1ReceiptSpreadsheetForIntegration000',
      sheet: { rows: [receiptRow('1FileForIntegrationTest0001')], issues: [], blankRowCount: 0 },
      months: ['2026-09'],
    };
    expect((await importLegacyReceiptRows(receiptDeps, tenantId, input)).counts).toMatchObject({
      created: 1,
    });
    expect((await importLegacyReceiptRows(receiptDeps, tenantId, input)).counts).toMatchObject({
      created: 0,
      unchanged: 1,
    });
    expect(await count(tenantId, 'receipts')).toBe(1);
    expect(storage.files.size).toBe(1);
  });
});

describe('取り込んだ行と記録の対応(legacy_imported_rows)', () => {
  /** 日報を1件取り込み、その対応と取込の実行の ID を返す。 */
  async function seed(tenantId: string) {
    const result = await importLegacyReportRows(
      { uow, appLog: new FakeAppLogPort() },
      tenantId,
      reportInput([dailyRow('メモ')]),
    );
    const [link] = await uow.run(tenantId, (r) => r.legacyImports.listBySource('gas_daily_report'));
    return { link: link as LegacyImportedRow, runId: result.runId as string };
  }

  it('同じ出どころ・キーは1行だけ(主キー)。別のテナントの同じキーは別の行で、互いに見えない', async () => {
    const a = await setup();
    const b = await setup();
    const { link, runId } = await seed(a.tenantId);
    const insert = (tenantId: string, careRecordId: string, importRunId: string) =>
      withTenant(app, tenantId, (tx) =>
        tx.execute(sql`insert into legacy_imported_rows
          (tenant_id, source, source_key, care_record_id, source_digest, synced_row_version, import_run_id)
          values (${tenantId}, 'gas_daily_report', ${link.sourceKey}, ${careRecordId}, '\\x00', 1, ${importRunId})`),
      );
    // 23505 unique_violation(主キー)
    expect(await sqlState(insert(a.tenantId, link.careRecordId as string, runId))).toBe('23505');
    const other = await seed(b.tenantId);
    expect(other.link.sourceKey).toBe(link.sourceKey);
    const visible = (await withTenant(app, b.tenantId, (tx) =>
      tx.execute(sql`select care_record_id from legacy_imported_rows`),
    )) as unknown as { care_record_id: string }[];
    expect(visible.map((v) => v.care_record_id)).toEqual([other.link.careRecordId]);
    // 別のテナントの記録は指せない(複合 FK)
    expect(await sqlState(insert(b.tenantId, link.careRecordId as string, other.runId))).not.toBeNull();
  });

  it('報告の行は記録だけを、領収書の行は領収書だけを指す(CHECK)', async () => {
    const a = await setup();
    const { link, runId } = await seed(a.tenantId);
    // 23514 check_violation
    expect(
      await sqlState(
        withTenant(app, a.tenantId, (tx) =>
          tx.execute(sql`insert into legacy_imported_rows
            (tenant_id, source, source_key, care_record_id, source_digest, synced_row_version, import_run_id)
            values (${a.tenantId}, 'gas_receipt', 'file', ${link.careRecordId}, '\\x00', 1, ${runId})`),
        ),
      ),
    ).toBe('23514');
  });

  it('アプリは対応を消せない(SELECT・INSERT・UPDATE だけ)。ワーカーは触れない', async () => {
    const privileges = async (role: string) =>
      (
        (await app.execute(sql`
          select p.privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
          where has_table_privilege(${role}, 'legacy_imported_rows', p.privilege)`)) as unknown as {
          privilege: string;
        }[]
      )
        .map((r) => r.privilege)
        .sort();
    expect(await privileges('katahimo_app')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    expect(await privileges('katahimo_worker')).toEqual([]);
  });
});
