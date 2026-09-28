import type { ReportAiExportSheet, ReportAiImportSheet } from '@katahimo/core/domain';
import { buildXlsxWorkbook, readXlsxSheets } from './xlsxSheets';

/**
 * 日報AIの調整のマスターの xlsx を読む・書く(POST /api/admin/report-ai/import・GET …/export.xlsx)。
 * シートの読み取り・値の解釈は core の reportAiImport.ts(ここはセルの値を取り出すだけ)。
 */

/** 読むシート・行・列の上限(マスターは数十行。壊れた・大きすぎるファイルでメモリを使い切らないように)。 */
const LIMITS = { maxSheets: 30, maxRows: 2000, maxColumns: 40 } as const;

/** xlsx を読んでシートのセルの表にする。読めないファイルは 400。 */
export function readReportAiWorkbook(body: Buffer): Promise<ReportAiImportSheet[]> {
  return readXlsxSheets(body, LIMITS);
}

/** マスターを xlsx にする(取込と同じシート名・見出し。書き出したファイルはそのまま取り込める)。 */
export function buildReportAiWorkbook(sheets: readonly ReportAiExportSheet[]): Promise<Buffer> {
  return buildXlsxWorkbook(sheets);
}
