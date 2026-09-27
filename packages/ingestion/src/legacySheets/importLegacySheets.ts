import type { LegacySpreadsheetPort } from '@katahimo/core/ports';
import {
  importLegacyReceiptRows,
  importLegacyReportRows,
  type LegacyImportDeps,
  type LegacyReceiptImportDeps,
  type LegacyReceiptImportResult,
  type LegacyReportImportResult,
} from '@katahimo/core/usecases';
import { parseReceiptSheet } from './receiptSheet';
import { parseAccidentReportSheet, parseDailyReportSheet } from './reportSheets';

/** GAS版のシートの名前(Main.js の REPORT_SHEET_NAME / ACCIDENT_SHEET_NAME)。 */
export const LEGACY_DAILY_REPORT_SHEET = '日報';
export const LEGACY_ACCIDENT_REPORT_SHEET = '事故報告';

export interface LegacyReportsImportRequest {
  tenantId: string;
  /** GAS版の SPREADSHEET_ID(「顧客DB 日報 事故報告」。legacy の Config.js)。 */
  spreadsheetId: string;
  dailySheetName?: string | undefined;
  accidentSheetName?: string | undefined;
  dryRun?: boolean | undefined;
}

/**
 * GAS版の「日報」「事故報告」シートを Google Sheets API で読み、日報・事故報告・ヒヤリハットを取り込む
 * (core/usecases/legacyImport/reports.ts)。シートを読めなければ何も書かずに例外。
 */
export async function importLegacyReports(
  deps: LegacyImportDeps & { sheets: LegacySpreadsheetPort },
  request: LegacyReportsImportRequest,
): Promise<LegacyReportImportResult> {
  const [daily, accident] = await Promise.all([
    deps.sheets.readSheet(request.spreadsheetId, request.dailySheetName ?? LEGACY_DAILY_REPORT_SHEET),
    deps.sheets.readSheet(request.spreadsheetId, request.accidentSheetName ?? LEGACY_ACCIDENT_REPORT_SHEET),
  ]);
  return importLegacyReportRows(
    deps,
    request.tenantId,
    {
      spreadsheetId: request.spreadsheetId,
      daily: parseDailyReportSheet(daily),
      accident: parseAccidentReportSheet(accident),
    },
    { dryRun: request.dryRun === true },
  );
}

export interface LegacyReceiptsImportRequest {
  tenantId: string;
  /** GAS版の IMAGE_LOG_SS_ID(「領収書一覧」。legacy の Config.js)。 */
  spreadsheetId: string;
  /** 省略は先頭のシート(GAS版は getSheets()[0] に書いた)。 */
  sheetName?: string | undefined;
  /** 取り込む月('YYYY-MM')。 */
  months: readonly string[];
  dryRun?: boolean | undefined;
}

/**
 * GAS版の「領収書一覧」を Google Sheets API で読み、指定の月の領収書を画像(Drive API)ごと取り込む
 * (core/usecases/legacyImport/receipts.ts)。
 */
export async function importLegacyReceipts(
  deps: LegacyReceiptImportDeps & { sheets: LegacySpreadsheetPort },
  request: LegacyReceiptsImportRequest,
): Promise<LegacyReceiptImportResult> {
  const sheet = await deps.sheets.readSheet(request.spreadsheetId, request.sheetName ?? null);
  return importLegacyReceiptRows(
    deps,
    request.tenantId,
    { spreadsheetId: request.spreadsheetId, sheet: parseReceiptSheet(sheet), months: request.months },
    { dryRun: request.dryRun === true },
  );
}
