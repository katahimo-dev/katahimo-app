import { type ImportCell, invalid, UNREADABLE_CELL } from '@katahimo/core/domain';
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

type RichText = { richText: { text: string }[] };
const richTextOf = (value: RichText) => value.richText.map((r) => r.text ?? '').join('');

/**
 * セルの値(式は残っている計算結果、書式つきの文字・リンクは文字だけ、結合セルは左上だけ)。エラーの値(#N/A 等)・
 * 計算結果の残っていない式・知らない形の値は空欄(null)にせず UNREADABLE_CELL にする(空欄 = 値の削除として読む取込で
 * 黙って値を消さないように。どう扱うかは core の取込が決める)。
 */
export function cellValue(cell: ExcelJS.Cell): ImportCell {
  if (cell.isMerged && cell.master.address !== cell.address) return null;
  const value = cell.value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return UNREADABLE_CELL;
  if ('richText' in value) return richTextOf(value);
  if ('error' in value) return UNREADABLE_CELL;
  if ('formula' in value || 'sharedFormula' in value || 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === 'string' || typeof result === 'boolean') return result;
    if (typeof result === 'number') return Number.isFinite(result) ? result : UNREADABLE_CELL;
    if (result instanceof Date) return result;
    return UNREADABLE_CELL;
  }
  if ('hyperlink' in value || 'text' in value) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === 'string') return text;
    if (typeof text === 'object' && text !== null && 'richText' in text) return richTextOf(text as RichText);
  }
  return UNREADABLE_CELL;
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
