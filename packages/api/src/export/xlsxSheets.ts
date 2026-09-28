import { type ImportCell, invalid } from '@katahimo/core/domain';
import ExcelJS from 'exceljs';

/**
 * 管理画面の取込・書き出しの xlsx(日報AIの調整のマスター・スタッフ)を読む・書く共通の処理。
 * シートの読み取り・値の解釈は core の純関数(ここはセルの値を取り出す・表を書くだけ)。
 */

export interface XlsxSheetCells {
  name: string;
  /** 1行目から順の行。各行は A 列から順のセルの値(結合セルは左上だけに値がある)。 */
  rows: ImportCell[][];
}

/** 読むシート・行・列の上限(壊れた・大きすぎるファイルでメモリを使い切らないように)。 */
export interface XlsxReadLimits {
  maxSheets: number;
  maxRows: number;
  maxColumns: number;
}

/** セルの値(式は計算結果、書式つきの文字は文字だけ、結合セルは左上だけ)。 */
export function cellValue(cell: ExcelJS.Cell): ImportCell {
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

/** xlsx を読んでシートのセルの表にする。読めないファイル・上限を超えるファイルは 400。 */
export async function readXlsxSheets(body: Buffer, limits: XlsxReadLimits): Promise<XlsxSheetCells[]> {
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
  if (workbook.worksheets.length > limits.maxSheets) {
    throw invalid(`シートが多すぎます(${limits.maxSheets}枚まで)`, undefined, 'too_many_sheets');
  }
  return workbook.worksheets.map((sheet) => {
    if (sheet.rowCount > limits.maxRows) {
      throw invalid(
        `シート「${sheet.name}」の行が多すぎます(${limits.maxRows}行まで)`,
        undefined,
        'too_many_rows',
      );
    }
    const rows: ImportCell[][] = [];
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const cells: ImportCell[] = [];
      for (let col = 1; col <= Math.min(row.cellCount, limits.maxColumns); col++)
        cells.push(cellValue(row.getCell(col)));
      rows.push(cells);
    }
    return { name: sheet.name, rows };
  });
}

export interface XlsxSheetToWrite {
  name: string;
  header: readonly string[];
  rows: readonly (readonly (string | number | null)[])[];
  /** 文字の書式(@)にする列(0始まり)。Excel が電話・日付の文字を数や日付に変えないように。 */
  textColumns?: readonly number[];
}

/** 表を xlsx にする(1行目は太字の見出しで固定)。 */
export async function buildXlsxWorkbook(sheets: readonly XlsxSheetToWrite[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'katahimo-app';
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow([...sheet.header]);
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
    for (const row of sheet.rows) ws.addRow(row.map((v) => v ?? null));
    const textColumns = new Set(sheet.textColumns ?? []);
    sheet.header.forEach((label, index) => {
      const column = ws.getColumn(index + 1);
      const longest = Math.max(
        String(label).length,
        ...sheet.rows.map((r) => String(r[index] ?? '').split('\n')[0]?.length ?? 0),
      );
      column.width = Math.min(60, Math.max(8, longest * 1.6));
      column.alignment = { vertical: 'top', wrapText: true };
      if (textColumns.has(index)) column.numFmt = '@';
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
