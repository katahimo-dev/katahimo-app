import { describe, expect, it } from 'vitest';
import {
  legacyReceiptsStorageProblem,
  MAX_LEGACY_RECEIPT_MONTHS,
  parseLegacyReceiptsArgs,
  parseLegacyReportsArgs,
} from './legacyImportArgs';

const ID = '1MuiQPr3qyws_xXhtta7DToxKCM5yAPv9IYHA5xfHPHg';
const argv = (...args: string[]) => ['node', 'script.ts', '--', ...args];

describe('import:legacy-reports の引数', () => {
  it('slug・スプレッドシートの ID・シート名・--dry-run を読む', () => {
    expect(parseLegacyReportsArgs(argv('cutest', '--spreadsheet', ID, '--dry-run'))).toEqual({
      ok: true,
      value: {
        slug: 'cutest',
        spreadsheetId: ID,
        dryRun: true,
        dailySheetName: undefined,
        accidentSheetName: undefined,
      },
    });
    expect(
      parseLegacyReportsArgs(
        argv('cutest', '--daily-sheet', '日報(旧)', '--spreadsheet', ID, '--accident-sheet', '事故'),
      ),
    ).toMatchObject({
      ok: true,
      value: { dryRun: false, dailySheetName: '日報(旧)', accidentSheetName: '事故' },
    });
  });

  it('slug・ID の無い・形の違う ID・知らない引数・値の無いシート名は使い方を出す', () => {
    expect(parseLegacyReportsArgs(argv('--spreadsheet', ID))).toMatchObject({ ok: false });
    expect(parseLegacyReportsArgs(argv('cutest'))).toMatchObject({ ok: false });
    expect(parseLegacyReportsArgs(argv('cutest', '--spreadsheet', 'short'))).toMatchObject({ ok: false });
    expect(parseLegacyReportsArgs(argv('cutest', '--spreadsheet', ID, '--month', '2026-09'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('--month'),
    });
    expect(parseLegacyReportsArgs(argv('cutest', '--spreadsheet', ID, '--daily-sheet'))).toMatchObject({
      ok: false,
    });
  });
});

describe('import:legacy-receipts の引数', () => {
  it('--month は何回でも、--from/--to は月の範囲にし、古い順・重複なしにする', () => {
    expect(
      parseLegacyReceiptsArgs(
        argv('cutest', '--spreadsheet', ID, '--month', '2026-09', '--month', '2026-08', '--month', '2026-09'),
      ),
    ).toEqual({
      ok: true,
      value: {
        slug: 'cutest',
        spreadsheetId: ID,
        dryRun: false,
        allowLocalStorage: false,
        sheetName: undefined,
        months: ['2026-08', '2026-09'],
      },
    });
    expect(
      parseLegacyReceiptsArgs(
        argv('cutest', '--spreadsheet', ID, '--from', '2025-11', '--to', '2026-02', '--sheet', 'シート1'),
      ),
    ).toMatchObject({
      ok: true,
      value: { sheetName: 'シート1', months: ['2025-11', '2025-12', '2026-01', '2026-02'] },
    });
  });

  it('月の無い・形の違う月・逆の範囲・片方だけの範囲・多すぎる月は使い方を出す', () => {
    const base = ['cutest', '--spreadsheet', ID];
    expect(parseLegacyReceiptsArgs(argv(...base))).toMatchObject({ ok: false });
    expect(parseLegacyReceiptsArgs(argv(...base, '--month', '2026-13'))).toMatchObject({ ok: false });
    expect(parseLegacyReceiptsArgs(argv(...base, '--month', '2026/09'))).toMatchObject({ ok: false });
    expect(parseLegacyReceiptsArgs(argv(...base, '--month'))).toMatchObject({ ok: false });
    expect(parseLegacyReceiptsArgs(argv(...base, '--from', '2026-09', '--to', '2026-08'))).toMatchObject({
      ok: false,
    });
    expect(parseLegacyReceiptsArgs(argv(...base, '--from', '2026-09'))).toMatchObject({ ok: false });
    expect(parseLegacyReceiptsArgs(argv(...base, '--from', '2020-01', '--to', '2026-12'))).toMatchObject({
      ok: false,
      message: expect.stringContaining(`${MAX_LEGACY_RECEIPT_MONTHS}か月`),
    });
  });

  it('画像はファイル置き場が GCS のときだけ取り込む(dry-run・--allow-local-storage は除く)', () => {
    const parsed = parseLegacyReceiptsArgs(
      argv('cutest', '--allow-local-storage', '--spreadsheet', ID, '--month', '2026-09'),
    );
    expect(parsed).toMatchObject({ ok: true, value: { allowLocalStorage: true } });
    const write = { dryRun: false, allowLocalStorage: false };
    expect(legacyReceiptsStorageProblem(write, 'local')).toContain('STORAGE_PROVIDER=gcs');
    expect(legacyReceiptsStorageProblem(write, 'gcs')).toBeNull();
    expect(legacyReceiptsStorageProblem({ ...write, dryRun: true }, 'local')).toBeNull();
    expect(legacyReceiptsStorageProblem({ ...write, allowLocalStorage: true }, 'local')).toBeNull();
  });
});
