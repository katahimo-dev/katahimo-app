import {
  buildReceiptDedupeKey,
  newId,
  RECEIPT_IMAGE_EXTENSIONS,
  receiptDedupeHash,
} from '@katahimo/core/domain';
import type {
  LegacyDriveFile,
  LegacyDriveFilePort,
  LegacySheet,
  LegacySpreadsheetPort,
  TenantRepositories,
  UnitOfWorkPort,
} from '@katahimo/core/ports';
import { createTestContext, type TestContext } from '@katahimo/core/test-utils';
import { RECEIPT_IMAGE_MAX_BYTES } from '@katahimo/shared';
import { describe, expect, it } from 'vitest';
import { importLegacyReceipts, importLegacyReports } from './importLegacySheets';
import {
  ACCIDENT_HEADER,
  DAILY_HEADER,
  driveLink,
  RECEIPT_HEADER,
  serial,
  type TestCell,
  testSheet,
  timeCell,
} from './testSheets';

const SPREADSHEET = '1MainSpreadsheetIdForTests000000000';
const RECEIPT_SPREADSHEET = '1ReceiptSpreadsheetIdForTests00000';

/** Sheets API の代わり(スプレッドシート → シート。先頭のシートは配列の最初)。 */
class FakeSheets implements LegacySpreadsheetPort {
  readonly books = new Map<string, LegacySheet[]>();
  async readSheet(spreadsheetId: string, sheetName: string | null): Promise<LegacySheet> {
    const sheets = this.books.get(spreadsheetId) ?? [];
    const sheet = sheetName === null ? sheets[0] : sheets.find((s) => s.title === sheetName);
    if (!sheet) throw new Error(`シートがありません: ${sheetName}`);
    return structuredClone(sheet);
  }
}

/** Drive API の代わり。 */
class FakeDrive implements LegacyDriveFilePort {
  readonly files = new Map<string, { mimeType: string; bytes: Uint8Array; trashed?: boolean }>();
  readonly downloaded: string[] = [];
  async getFile(fileId: string): Promise<LegacyDriveFile | null> {
    const file = this.files.get(fileId);
    return file
      ? { id: fileId, mimeType: file.mimeType, byteSize: file.bytes.length, trashed: file.trashed === true }
      : null;
  }
  async download(fileId: string): Promise<Uint8Array> {
    const file = this.files.get(fileId);
    if (!file) throw new Error('404');
    this.downloaded.push(fileId);
    return file.bytes;
  }
}

const jpeg = (n = 1) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n]);

async function setup() {
  const ctx = createTestContext();
  const { staff } = await ctx.addStaff('山田 太郎', 'taro@example.com');
  const retired = await ctx.addStaff('鈴木 一郎', 'ichiro@example.com');
  ctx.setRetiredOn(retired.staff.id, '2026-08-31');
  const customerId = await ctx.addCustomer('佐藤 花子', '1001', [
    { name: '佐藤 はな', birthDate: '2022-04-01' },
  ]);
  const sheets = new FakeSheets();
  const drive = new FakeDrive();
  const deps = { uow: ctx.uow, appLog: ctx.appLog, storage: ctx.storage, sheets, drive };
  return { ctx, deps, sheets, drive, staffId: staff.id, retiredId: retired.staff.id, customerId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function dailyRow(
  overrides: Partial<Record<'ts' | 'staff' | 'customer' | 'input' | 'risk' | 'id', TestCell>> = {},
) {
  return [
    overrides.ts ?? serial('2026/09/05 09:00:00'),
    timeCell('09:00'),
    timeCell('12:00'),
    overrides.staff ?? '山田 太郎',
    overrides.customer ?? 1001,
    '佐藤様',
    overrides.input ?? 'メモ',
    '社内向け',
    'ご家庭向け',
    overrides.risk ?? 4,
    5,
    overrides.id ?? '',
  ];
}

function accidentRow(type: string, ts = '2026/09/06 15:00:00') {
  return [
    serial(ts),
    '山田 太郎',
    1001,
    '佐藤様',
    '佐藤 はな',
    '2022/04/01',
    '14:00',
    '居間',
    '転倒',
    '',
    '',
    '',
    '',
    '',
    '',
    type,
  ];
}

function setReportSheets(s: Setup, daily: TestCell[][], accident: TestCell[][] = []) {
  s.sheets.books.set(SPREADSHEET, [
    testSheet('日報', [DAILY_HEADER, ...daily]),
    testSheet('事故報告', [ACCIDENT_HEADER, ...accident]),
  ]);
}

const runReports = (s: Setup, dryRun = false) =>
  importLegacyReports(s.deps, { tenantId: s.ctx.tenantId, spreadsheetId: SPREADSHEET, dryRun });

describe('importLegacyReports(GAS版の日報・事故報告の取込)', () => {
  it('全ての行を記録にし(担当は氏名・顧客は RESERVA の顧客ID で探す)、ミラー・通知は積まない', async () => {
    const s = await setup();
    setReportSheets(
      s,
      [
        dailyRow(),
        dailyRow({ ts: serial('2026/08/01 10:00:00'), staff: '鈴木　一郎' }),
        dailyRow({ staff: '知らない人' }),
        dailyRow({ customer: 9999 }),
        dailyRow({ customer: '' }),
        dailyRow({ id: 'app-report-id' }),
      ],
      [accidentRow('事故報告'), accidentRow('ヒヤリハット', '2026/09/07 10:00:00')],
    );
    const result = await runReports(s);
    expect(result.counts.gas_daily_report).toMatchObject({ created: 2, errors: 3, fromApp: 1, unchanged: 0 });
    expect(result.counts.gas_accident_report).toMatchObject({ created: 2, errors: 0 });
    expect(result.issues.map((i) => [i.rowNumber, i.reason])).toEqual([
      [4, 'staff_not_found'],
      [5, 'customer_not_found'],
      [6, 'customer_missing'],
      [7, 'from_app'],
    ]);

    const records = s.ctx.data().careRecords;
    expect(records.map((r) => r.recordType).sort()).toEqual([
      'accident',
      'daily_report',
      'daily_report',
      'near_miss',
    ]);
    const daily = records.find((r) => r.recordType === 'daily_report' && r.authorStaffId === s.staffId);
    expect(daily).toMatchObject({
      status: 'submitted',
      customerId: s.customerId,
      occurredAt: new Date('2026-09-05T00:00:00Z'),
      servicePeriod: { start: new Date('2026-09-05T00:00:00Z'), end: new Date('2026-09-05T03:00:00Z') },
      riskRating: 4,
      esRating: 5,
      body: {
        startTime: '09:00',
        endTime: '12:00',
        inputText: 'メモ',
        internalText: '社内向け',
        customerText: 'ご家庭向け',
      },
      careRecipientId: s.ctx.data().recipients[0]?.id,
      retainUntil: '2031-09-04',
    });
    // 退職したスタッフも氏名で見つける(空白の違いは無視する)
    expect(records.some((r) => r.authorStaffId === s.retiredId)).toBe(true);
    expect(records.find((r) => r.recordType === 'near_miss')).toMatchObject({
      careRecipientId: null,
      riskRating: null,
      occurredAt: new Date('2026-09-07T01:00:00Z'),
    });
    expect(s.ctx.data().outbox).toEqual([]);
    expect(s.ctx.notifier.notifications).toEqual([]);
    expect(s.ctx.data().importRuns).toEqual([
      expect.objectContaining({
        source: 'legacy_reports_sheet',
        status: 'applied',
        fileName: SPREADSHEET,
        counts: expect.objectContaining({ 'gas_daily_report.created': 2, 'gas_daily_report.errors': 3 }),
      }),
    ]);
    expect(s.ctx.db.legacyImportLocks.length).toBeGreaterThan(0);
    const log = s.ctx.data().appLogs.find((l) => l.action === 'legacy_import.reports.done');
    expect(log).toMatchObject({ level: 'WARN' });
    // 操作ログに氏名・本文は残さない
    expect(JSON.stringify(log?.details)).not.toMatch(/山田|メモ|佐藤/);
  });

  it('2回流しても記録は増えない(2回目は全て変更なし)', async () => {
    const s = await setup();
    setReportSheets(
      s,
      [dailyRow(), dailyRow({ ts: serial('2026/09/06 09:00:00') })],
      [accidentRow('事故報告')],
    );
    await runReports(s);
    const again = await runReports(s);
    expect(again.counts.gas_daily_report).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(again.counts.gas_accident_report).toMatchObject({ created: 0, unchanged: 1 });
    expect(s.ctx.data().careRecords).toHaveLength(3);
    expect(s.ctx.data().importRuns.map((r) => r.status)).toEqual(['applied', 'applied']);
  });

  it('シートで直された行は記録を直し(変更前は履歴に残る)、次の取込では変更なし', async () => {
    const s = await setup();
    setReportSheets(s, [dailyRow()]);
    await runReports(s);
    const before = s.ctx.data().careRecords[0];
    setReportSheets(s, [dailyRow({ input: '直したメモ', risk: 2 })]);
    const result = await runReports(s);
    expect(result.counts.gas_daily_report).toMatchObject({ updated: 1, created: 0 });
    const after = s.ctx.data().careRecords[0];
    expect(after?.id).toBe(before?.id);
    expect(after).toMatchObject({ riskRating: 2, body: { inputText: '直したメモ' }, rowVersion: 2 });
    expect(s.ctx.data().careRecordRevisions).toEqual([
      expect.objectContaining({
        careRecordId: before?.id,
        body: expect.objectContaining({ inputText: 'メモ' }),
      }),
    ]);
    // PSI 2 でも取込は知らせない
    expect(s.ctx.data().outbox).toEqual([]);
    expect((await runReports(s)).counts.gas_daily_report).toMatchObject({ updated: 0, unchanged: 1 });
  });

  it('確定済みの記録・取込の後に本アプリで直された記録は、シートが変わっても直さない', async () => {
    const s = await setup();
    setReportSheets(s, [dailyRow(), dailyRow({ ts: serial('2026/09/06 09:00:00') })]);
    await runReports(s);
    const [first, second] = s.ctx.data().careRecords;
    if (!first || !second) throw new Error('記録がありません');
    first.status = 'locked';
    await s.ctx.uow.run(s.ctx.tenantId, (r) =>
      r.careRecords.update(second.id, { body: { ...second.body, inputText: 'アプリで直した' } }),
    );
    // シートが変わっていなければ、アプリで直した記録もそのまま(変更なし)
    expect((await runReports(s)).counts.gas_daily_report).toMatchObject({ unchanged: 2, skipped: 0 });

    setReportSheets(s, [
      dailyRow({ input: 'シートで直した' }),
      dailyRow({ ts: serial('2026/09/06 09:00:00'), input: 'シートで直した' }),
    ]);
    const result = await runReports(s);
    expect(result.counts.gas_daily_report).toMatchObject({ updated: 0, skipped: 2 });
    expect(result.issues.map((i) => [i.rowNumber, i.reason])).toEqual([
      [2, 'locked'],
      [3, 'edited_in_app'],
    ]);
    expect(s.ctx.data().careRecords.map((r) => (r.body as { inputText: string }).inputText)).toEqual([
      'メモ',
      'アプリで直した',
    ]);
  });

  it('取込済みの行が今のシートに無ければ、記録の ID を知らせる(記録は消さない)', async () => {
    const s = await setup();
    setReportSheets(s, [dailyRow()]);
    await runReports(s);
    setReportSheets(s, [dailyRow({ ts: serial('2026/09/05 10:00:00') })]);
    const result = await runReports(s);
    expect(result.counts.gas_daily_report).toMatchObject({ created: 1, missingFromSheet: 1 });
    expect(result.missingFromSheet).toEqual([
      { source: 'gas_daily_report', careRecordId: s.ctx.data().careRecords[0]?.id },
    ]);
    expect(s.ctx.data().careRecords).toHaveLength(2);
  });

  it('dry-run は何も書かずに件数だけを返す', async () => {
    const s = await setup();
    setReportSheets(s, [dailyRow(), dailyRow({ staff: '知らない人' })], [accidentRow('事故報告')]);
    const result = await runReports(s, true);
    expect(result).toMatchObject({ dryRun: true, runId: null });
    expect(result.counts.gas_daily_report).toMatchObject({ created: 1, errors: 1 });
    expect(result.counts.gas_accident_report).toMatchObject({ created: 1 });
    expect(s.ctx.data().careRecords).toEqual([]);
    expect(s.ctx.data().importRuns).toEqual([]);
    expect(s.ctx.data().legacyImportedRows).toEqual([]);
  });

  it('シートを読めなければ何も書かずに失敗する', async () => {
    const s = await setup();
    await expect(runReports(s)).rejects.toThrow('シートがありません');
    expect(s.ctx.data().importRuns).toEqual([]);
  });
});

const RECEIPT_TS = '2026/09/05 12:30:00';

function receiptRow(
  fileId: string,
  overrides: Partial<
    Record<'ts' | 'staff' | 'customer' | 'amount' | 'store' | 'handoff' | 'id', TestCell>
  > = {},
) {
  return [
    overrides.ts ?? serial(RECEIPT_TS),
    overrides.staff ?? '山田 太郎',
    overrides.customer ?? 1001,
    '佐藤様',
    overrides.amount ?? 1200,
    overrides.store ?? 'コンビニ',
    driveLink(fileId),
    overrides.handoff ?? '',
    overrides.id ?? '',
  ];
}

const fileId = (n: number) => `1File${String(n).padStart(20, '0')}`;

function setReceiptSheet(s: Setup, rows: TestCell[][]) {
  s.sheets.books.set(RECEIPT_SPREADSHEET, [testSheet('シート1', [RECEIPT_HEADER, ...rows])]);
}

const runReceipts = (s: Setup, months: string[], dryRun = false) =>
  importLegacyReceipts(s.deps, {
    tenantId: s.ctx.tenantId,
    spreadsheetId: RECEIPT_SPREADSHEET,
    months,
    dryRun,
  });

describe('importLegacyReceipts(GAS版の領収書一覧の取込)', () => {
  it('指定の月の行だけを、画像ごと1行1回の登録として取り込む(申し送りはその行の分)', async () => {
    const s = await setup();
    for (const n of [1, 2, 3, 4]) s.drive.files.set(fileId(n), { mimeType: 'image/jpeg', bytes: jpeg(n) });
    setReceiptSheet(s, [
      receiptRow(fileId(1), { handoff: '申し送りです' }),
      receiptRow(fileId(2), { customer: 7777, amount: '800円', store: 'タクシー' }),
      receiptRow(fileId(3), { ts: serial('2026/08/31 23:59:00') }),
      receiptRow(fileId(4), { customer: '', amount: 'よく分からない', store: '' }),
      receiptRow(fileId(5), { id: 'app-receipt-id' }),
    ]);
    const result = await runReceipts(s, ['2026-09']);
    expect(result.counts).toMatchObject({ created: 3, outOfRange: 1, fromApp: 1, errors: 0, warnings: 2 });
    expect(result.issues.map((i) => [i.rowNumber, i.reason])).toEqual([
      [3, 'customer_unlinked'],
      [5, 'amount_invalid'],
      [6, 'from_app'],
    ]);
    const receipts = s.ctx.data().receipts;
    expect(receipts).toHaveLength(3);
    expect(new Set(receipts.map((r) => r.uploadId)).size).toBe(3);
    const first = receipts[0];
    expect(first).toMatchObject({
      staffId: s.staffId,
      customerId: s.customerId,
      customerNameText: null,
      receiptedAt: new Date('2026-09-05T03:30:00Z'),
      amountYen: 1200,
      storeName: 'コンビニ',
      companyPaid: false,
      cancelledAt: null,
      dedupePrimary: true,
    });
    expect(receipts[1]).toMatchObject({ customerId: null, customerNameText: '佐藤様', amountYen: 800 });
    expect(receipts[2]).toMatchObject({
      customerId: null,
      customerNameText: '佐藤様',
      amountYen: null,
      dedupeHash: null,
    });
    expect(s.ctx.data().uploads.map((u) => u.handoffText)).toEqual(['申し送りです', null, null]);
    const file = s.ctx.data().files.find((f) => f.id === first?.fileId);
    expect(file).toMatchObject({ contentType: 'image/jpeg', purpose: 'receipt_image', byteSize: 5 });
    expect(file?.storageKey).toBe(
      `${s.ctx.tenantId}/receipts/${file?.id}.${RECEIPT_IMAGE_EXTENSIONS['image/jpeg']}`,
    );
    expect(s.ctx.storage.files.size).toBe(3);
    expect(s.drive.downloaded).toEqual([fileId(1), fileId(2), fileId(4)]);
    expect(s.ctx.data().outbox).toEqual([]);
    expect(s.ctx.notifier.notifications).toEqual([]);
    expect(s.ctx.data().importRuns[0]).toMatchObject({ source: 'legacy_receipts_sheet', status: 'applied' });
  });

  it('2回流しても領収書・画像は増えない。取込の後にシートの行が変わっても直さずに注意だけ', async () => {
    const s = await setup();
    s.drive.files.set(fileId(1), { mimeType: 'image/jpeg', bytes: jpeg() });
    setReceiptSheet(s, [receiptRow(fileId(1))]);
    await runReceipts(s, ['2026-09']);
    const again = await runReceipts(s, ['2026-09']);
    expect(again.counts).toMatchObject({ created: 0, unchanged: 1, warnings: 0 });
    setReceiptSheet(s, [receiptRow(fileId(1), { amount: 9999 })]);
    const changed = await runReceipts(s, ['2026-09']);
    expect(changed.counts).toMatchObject({ created: 0, unchanged: 1, warnings: 1 });
    expect(changed.issues).toEqual([{ source: 'gas_receipt', rowNumber: 2, reason: 'changed_in_sheet' }]);
    expect(s.ctx.data().receipts).toHaveLength(1);
    expect(s.ctx.data().receipts[0]?.amountYen).toBe(1200);
    expect(s.ctx.storage.files.size).toBe(1);
    expect(s.drive.downloaded).toEqual([fileId(1)]);
  });

  it('本アプリで登録した同じ内容の領収書があれば取り込まない。GAS版の同じ内容の行(往復の運賃)は全て取り込む', async () => {
    const s = await setup();
    for (const n of [1, 2, 3, 4]) s.drive.files.set(fileId(n), { mimeType: 'image/jpeg', bytes: jpeg(n) });
    // 本アプリで登録済み: 12:30 の 1200円 コンビニ
    await s.ctx.uow.run(s.ctx.tenantId, async (r) => {
      const uploadId = newId();
      const storedId = newId();
      await r.receipts.createUpload({
        id: uploadId,
        staffId: s.staffId,
        customerId: s.customerId,
        customerNameText: null,
        handoffText: null,
        createdBy: s.staffId,
      });
      await r.storedFiles.insert({
        id: storedId,
        storageKey: 'app.jpg',
        contentType: 'image/jpeg',
        byteSize: 1,
        sha256: new Uint8Array(32),
        purpose: 'receipt_image',
        createdBy: s.staffId,
      });
      const key = buildReceiptDedupeKey({
        timestamp: RECEIPT_TS,
        staffId: s.staffId,
        customerId: s.customerId,
        amount: 1200,
        storeName: 'コンビニ',
      });
      await r.receipts.insertIfNew({
        id: newId(),
        uploadId,
        fileId: storedId,
        staffId: s.staffId,
        customerId: s.customerId,
        customerNameText: null,
        receiptedAt: new Date('2026-09-05T03:30:00Z'),
        amountYen: 1200,
        storeName: 'コンビニ',
        companyPaid: false,
        dedupeHash: receiptDedupeHash(key),
        dedupePrimary: true,
      });
    });
    setReceiptSheet(s, [
      receiptRow(fileId(1)),
      receiptRow(fileId(2), { amount: 300, store: 'バス' }),
      receiptRow(fileId(3), { amount: 300, store: 'バス' }),
      receiptRow(fileId(4), { amount: 300, store: 'バス' }),
    ]);
    const dry = await runReceipts(s, ['2026-09'], true);
    expect(dry.counts).toMatchObject({ created: 3, skipped: 1 });
    const result = await runReceipts(s, ['2026-09']);
    expect(result.counts).toMatchObject({ created: 3, skipped: 1 });
    expect(result.issues).toEqual([{ source: 'gas_receipt', rowNumber: 2, reason: 'duplicate' }]);
    const bus = s.ctx.data().receipts.filter((r) => r.storeName === 'バス');
    expect(bus.map((r) => r.dedupePrimary)).toEqual([true, false, false]);
    // 重複にした画像はファイル置き場に残さない
    expect(s.ctx.storage.files.size).toBe(3);
    expect((await runReceipts(s, ['2026-09'])).counts).toMatchObject({
      created: 0,
      unchanged: 3,
      skipped: 1,
    });
  });

  it('担当が見つからない行・取り込めない画像(HEIC・大きすぎる・中身が画像でない・無い)は取り込まない', async () => {
    const s = await setup();
    s.drive.files.set(fileId(1), { mimeType: 'image/heic', bytes: jpeg() });
    s.drive.files.set(fileId(2), {
      mimeType: 'image/jpeg',
      bytes: new Uint8Array(RECEIPT_IMAGE_MAX_BYTES + 1),
    });
    s.drive.files.set(fileId(3), { mimeType: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) });
    s.drive.files.set(fileId(4), { mimeType: 'image/jpeg', bytes: jpeg(), trashed: true });
    s.drive.files.set(fileId(6), { mimeType: 'image/jpeg', bytes: jpeg() });
    setReceiptSheet(s, [
      receiptRow(fileId(1), { store: 'a' }),
      receiptRow(fileId(2), { store: 'b' }),
      receiptRow(fileId(3), { store: 'c' }),
      receiptRow(fileId(4), { store: 'd' }),
      receiptRow(fileId(5), { store: 'e' }),
      receiptRow(fileId(6), { staff: '知らない人' }),
    ]);
    const dry = await runReceipts(s, ['2026-09'], true);
    // dry-run は Drive のメタデータだけを見る(中身が画像でないことは読むまで分からない)
    expect(dry.issues.map((i) => [i.rowNumber, i.reason])).toEqual([
      [2, 'image_unsupported_type'],
      [3, 'image_too_large'],
      [5, 'image_unavailable'],
      [6, 'image_unavailable'],
      [7, 'staff_not_found'],
    ]);
    expect(s.drive.downloaded).toEqual([]);
    const result = await runReceipts(s, ['2026-09']);
    expect(result.counts).toMatchObject({ created: 0, errors: 6 });
    expect(result.issues.map((i) => [i.rowNumber, i.reason])).toContainEqual([4, 'image_unsupported_type']);
    expect(s.ctx.data().receipts).toEqual([]);
    expect(s.ctx.storage.files.size).toBe(0);
  });

  it('書き込みに失敗したら保存した画像を消し、取込の実行を失敗にする', async () => {
    const s = await setup();
    s.drive.files.set(fileId(1), { mimeType: 'image/jpeg', bytes: jpeg() });
    setReceiptSheet(s, [receiptRow(fileId(1))]);
    const failing = { ...s.deps, uow: new FailingUow(s.ctx) };
    await expect(
      importLegacyReceipts(failing, {
        tenantId: s.ctx.tenantId,
        spreadsheetId: RECEIPT_SPREADSHEET,
        months: ['2026-09'],
      }),
    ).rejects.toThrow('書き込みの失敗');
    expect(s.ctx.storage.files.size).toBe(0);
    expect(s.ctx.data().receipts).toEqual([]);
    expect(s.ctx.data().importRuns[0]).toMatchObject({ status: 'failed' });
    expect(s.ctx.data().appLogs.map((l) => l.action)).toContain('legacy_import.receipts.failed');
  });
});

/** 取込のロックを取るトランザクション(書き込み)だけを失敗させる UoW。 */
class FailingUow implements UnitOfWorkPort {
  constructor(private readonly ctx: TestContext) {}
  run<T>(tenantId: string, work: (repos: TenantRepositories) => Promise<T>): Promise<T> {
    return this.ctx.uow.run(tenantId, (r) =>
      work({
        ...r,
        legacyImports: {
          ...r.legacyImports,
          lockTenantLegacyImports: async () => {
            throw new Error('書き込みの失敗(テスト)');
          },
        },
      }),
    );
  }
}
