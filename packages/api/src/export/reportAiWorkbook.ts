import {
  type ImportCell,
  invalid,
  type ReportAiExportSheet,
  type ReportAiImportSheet,
} from '@katahimo/core/domain';
import ExcelJS from 'exceljs';

/**
 * 日報AIの調整のマスターの xlsx を読む・書く(POST /api/admin/report-ai/import・GET …/export.xlsx)。
 * シートの読み取り・値の解釈は core の reportAiImport.ts(ここはセルの値を取り出すだけ)。
 */

/** 読むシート・行・列の上限(マスターは数十行。壊れた・大きすぎるファイルでメモリを使い切らないように)。 */
const MAX_SHEETS = 30;
const MAX_ROWS = 2000;
const MAX_COLUMNS = 40;

/** セルの値(式は計算結果、書式つきの文字は文字だけ、結合セルは左上だけ)。 */
function cellValue(cell: ExcelJS.Cell): ImportCell {
  if (cell.isMerged && cell.master.address !== cell.address) return null;
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('result' in value) {
      const result = value.result;
      return result instanceof Date || typeof result !== 'object' ? (result ?? null) : null;
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
  }
  return null;
}

/** xlsx を読んでシートのセルの表にする。読めないファイルは 400。 */
export async function readReportAiWorkbook(body: Buffer): Promise<ReportAiImportSheet[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
  } catch {
    throw invalid(
      'Excel(.xlsx)のファイルを読めませんでした',
      { file: 'xlsx のファイルを選んでください' },
      'invalid_xlsx',
    );
  }
  if (workbook.worksheets.length > MAX_SHEETS) {
    throw invalid(`シートが多すぎます(${MAX_SHEETS}枚まで)`, undefined, 'too_many_sheets');
  }
  return workbook.worksheets.map((sheet) => {
    if (sheet.rowCount > MAX_ROWS) {
      throw invalid(`シート「${sheet.name}」の行が多すぎます(${MAX_ROWS}行まで)`, undefined, 'too_many_rows');
    }
    const rows: ImportCell[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cells: ImportCell[] = [];
      for (let col = 1; col <= Math.min(row.cellCount, MAX_COLUMNS); col++)
        cells.push(cellValue(row.getCell(col)));
      rows.push(cells);
    }
    return { name: sheet.name, rows };
  });
}

/** マスターを xlsx にする(取込と同じシート名・見出し。書き出したファイルはそのまま取り込める)。 */
export async function buildReportAiWorkbook(sheets: readonly ReportAiExportSheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'katahimo-app';
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(sheet.header);
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    for (const row of sheet.rows) ws.addRow(row.map((v) => v ?? null));
    ws.columns.forEach((column, index) => {
      const longest = Math.max(
        String(sheet.header[index] ?? '').length,
        ...sheet.rows.map((r) => String(r[index] ?? '').split('\n')[0]?.length ?? 0),
      );
      column.width = Math.min(60, Math.max(8, longest * 1.6));
      column.alignment = { vertical: 'top', wrapText: true };
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
