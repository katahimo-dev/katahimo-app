import { type ImportCell, invalid, UNREADABLE_CELL } from '@katahimo/core/domain';
import ExcelJS from 'exceljs';
import { inspectZip, XLSX_ZIP_LIMITS } from './xlsxZipGuard';

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

const INVALID_XLSX_MESSAGE = 'Excel(.xlsx)のファイルを読めませんでした';
const INVALID_XLSX_FIELDS = { file: 'xlsx のファイルを選んでください' };

const toMib = (bytes: number) => bytes / (1024 * 1024);

/**
 * exceljs に渡す前に zip の目次と展開後の大きさを確かめる(xlsxZipGuard.ts)。中のファイルが多すぎる・展開すると大きすぎる
 * ファイルは 400 `xlsx_too_large`、zip として読めない・暗号化・ZIP64・目次と中身の合わないファイルは 400 `invalid_xlsx`。
 */
function assertSafeXlsxZip(body: Buffer): void {
  const result = inspectZip(body, XLSX_ZIP_LIMITS);
  if (result.ok) return;
  switch (result.reason) {
    case 'too_many_entries':
      throw invalid(
        `Excel(.xlsx)のファイルの中のファイルが多すぎます(${XLSX_ZIP_LIMITS.maxEntries}個まで)`,
        { file: '取り込む表だけのファイルにしてください' },
        'xlsx_too_large',
      );
    case 'entry_too_large':
    case 'total_too_large':
    case 'ratio_too_high':
      throw invalid(
        `Excel(.xlsx)のファイルの中身が大きすぎます(展開して合計${toMib(XLSX_ZIP_LIMITS.maxTotalBytes)}MB・中の1つのファイル${toMib(XLSX_ZIP_LIMITS.maxEntryBytes)}MBまで)`,
        { file: '取り込む表だけのファイルにしてください' },
        'xlsx_too_large',
      );
    default:
      throw invalid(INVALID_XLSX_MESSAGE, INVALID_XLSX_FIELDS, 'invalid_xlsx');
  }
}

/**
 * xlsx を読む(exceljs で展開する)のを同時にいくつまでにするか(このインスタンスの中)。exceljs は展開した XML の
 * 数十倍のメモリを使うため、取込(スタッフ・日報AIの調整)が重なって API のメモリを使い切らないよう1つずつにする
 * (全員分の出勤簿の書き出しと同じ考え方)。
 */
const MAX_CONCURRENT_XLSX_READS = 1;
let xlsxReadsInFlight = 0;

/** 読んでいる間に来た取込への 429 の文言と、Retry-After。 */
export const XLSX_READ_BUSY_MESSAGE =
  'ほかの Excel の取込を読んでいます。少し待ってからもう一度お試しください。';
export const XLSX_READ_BUSY_RETRY_MS = 10_000;

/**
 * xlsx を読む処理を、このインスタンスで同時に MAX_CONCURRENT_XLSX_READS 個までにして動かす。
 * 枠が埋まっていれば読まずに `{ ok: false }`(呼ぶ側が 429 + Retry-After にする)。
 */
export async function withXlsxReadSlot<T>(
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  if (xlsxReadsInFlight >= MAX_CONCURRENT_XLSX_READS) return { ok: false };
  xlsxReadsInFlight++;
  try {
    return { ok: true, value: await read() };
  } finally {
    xlsxReadsInFlight--;
  }
}

/** xlsx を読んでシートのセルの表にする。読めないファイル・上限を超えるファイルは 400。 */
export async function readXlsxSheets(body: Buffer, limits: XlsxReadLimits): Promise<XlsxSheetCells[]> {
  assertSafeXlsxZip(body);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
  } catch {
    throw invalid(INVALID_XLSX_MESSAGE, INVALID_XLSX_FIELDS, 'invalid_xlsx');
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
