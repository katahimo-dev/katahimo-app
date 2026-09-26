import {
  ATTENDANCE_SHEET_COLUMNS,
  ATTENDANCE_SHEET_ROWS,
  ATTENDANCE_SHEET_SUMMARY_ITEMS,
  type AttendanceSheetColumn,
  excelTimeValue,
  type SheetCellKind,
  type SheetColumnRole,
  type SheetFormulaContext,
  sheetInputValue,
  uniqueSheetNames,
} from '@katahimo/core/domain';
import type { AttendanceExportMonth, AttendanceExportStaff } from '@katahimo/core/usecases';
import ExcelJS from 'exceljs';

/**
 * 出勤簿の Excel(.xlsx)を作る(GET /api/attendance/export ・ /export/all)。列の並び・見出し・計算式は
 * core の sheetTemplate.ts(お客様の出勤簿テンプレートと同じ)。ここはシートの組み立て(見出し・日の行・合計・
 * 月の集計・領収書の明細)と見た目だけを受け持つ。計算の列は Excel の式で書き、開いたときに計算させる
 * (fullCalcOnLoad)。入力の値は今月のまとめと同じ読み方(loadAttendanceMonth)の rowData。
 */

const FONT_NAME = '游ゴシック';
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** 見出しの色(テンプレートの凡例と同じ色 + 計算式の灰色)。 */
const ROLE_FILL: Record<SheetColumnRole, string> = {
  date: 'FFF3F3F3',
  calendar: 'FFC9DAF8',
  manual: 'FFB5E6A2',
  formula: 'FFE7E6E6',
};
const FORMULA_CELL_FILL = 'FFF7F7F7';
const TOTALS_FILL = 'FFFFF2CC';
const RECEIPT_TOTAL_FILL = 'FFFFFF00';

/**
 * 表示の形式。日の行の計算の列は 0 を空に見せる(記録の無い日に 0:00 や 0 が並ばないように。値は 0 のまま)。
 */
function numberFormat(kind: SheetCellKind, hideZero: boolean): string {
  const base: Partial<Record<SheetCellKind, string>> = {
    date: 'd',
    time: 'h:mm',
    minutes: '#,##0',
    minutesDecimal: '#,##0.##',
    km: '#,##0.0#',
    count: '#,##0',
    yen: '#,##0',
    number: 'General',
  };
  const format = base[kind] ?? 'General';
  if (!hideZero || format === 'General') return format;
  return `${format};-${format};`;
}

const thin = { style: 'thin' as const, color: { argb: 'FF999999' } };
const hair = { style: 'hair' as const, color: { argb: 'FFBBBBBB' } };
const GRID: Partial<ExcelJS.Borders> = { top: hair, bottom: hair, left: hair, right: hair };
const BOX: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin };

const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const font = (extra: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({
  name: FONT_NAME,
  size: 10,
  ...extra,
});

/** 'YYYY-MM-DD' → Excel の日付(時刻の無い日付。exceljs は UTC の0時を日付の値にする)。 */
function excelDate(businessDate: string): Date {
  const [y, m, d] = businessDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function weekdayOf(businessDate: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[excelDate(businessDate).getUTCDay()] as (typeof WEEKDAYS)[number];
}

/** 1シートの中の行の位置(日の数・領収書の件数で決まる)。 */
export interface SheetLayout {
  firstDay: number;
  lastDay: number;
  totals: number;
  note: number;
  summaryTitle: number;
  summaryFirst: number;
  receiptCount: number;
  receiptTotal: number;
  receiptTitle: number;
  receiptHeader: number;
  receiptFirst: number;
  receiptLast: number;
}

export function sheetLayoutOf(dayCount: number, receiptCount: number): SheetLayout {
  const firstDay = ATTENDANCE_SHEET_ROWS.firstDay;
  const lastDay = firstDay + dayCount - 1;
  const totals = lastDay + 1;
  const summaryTitle = totals + 3;
  const summaryFirst = summaryTitle + 1;
  const receiptCountRow = summaryFirst + ATTENDANCE_SHEET_SUMMARY_ITEMS.length;
  const receiptTotal = receiptCountRow + 1;
  const receiptTitle = receiptTotal + 2;
  const receiptHeader = receiptTitle + 1;
  const receiptFirst = receiptHeader + 1;
  return {
    firstDay,
    lastDay,
    totals,
    note: totals + 1,
    summaryTitle,
    summaryFirst,
    receiptCount: receiptCountRow,
    receiptTotal,
    receiptTitle,
    receiptHeader,
    receiptFirst,
    // 領収書が無くても1行分の範囲にする(日の行の SUMIFS が空の範囲を参照しないように)
    receiptLast: receiptFirst + Math.max(receiptCount, 1) - 1,
  };
}

/** 領収書の明細の列(日付の列は日の列と同じ A。SUMIFS で日の行と突き合わせる)。 */
const RECEIPT_COLUMNS = {
  date: 'A',
  time: 'B',
  customer: 'C',
  store: ['D', 'G'],
  amount: 'H',
  handoff: ['I', 'W'],
} as const;

function formulaContext(layout: SheetLayout): SheetFormulaContext {
  const range = (col: string) => `$${col}$${layout.receiptFirst}:$${col}$${layout.receiptLast}`;
  return { receiptDateRange: range(RECEIPT_COLUMNS.date), receiptAmountRange: range(RECEIPT_COLUMNS.amount) };
}

function writeHeader(
  ws: ExcelJS.Worksheet,
  staff: AttendanceExportStaff,
  month: AttendanceExportMonth,
): void {
  const [year, monthNumber] = month.month.yearMonth.split('-').map(Number) as [number, number];
  const labels = ATTENDANCE_SHEET_ROWS.headerLabels;
  const values = ATTENDANCE_SHEET_ROWS.headerValues;
  const put = (ref: string, value: ExcelJS.CellValue, style: Partial<ExcelJS.Style>) => {
    const cell = ws.getCell(ref);
    cell.value = value;
    cell.style = style;
  };
  const labelStyle: Partial<ExcelJS.Style> = {
    font: font({ bold: true }),
    alignment: { horizontal: 'center', vertical: 'middle' },
    fill: fill(ROLE_FILL.date),
    border: BOX,
  };
  const valueStyle: Partial<ExcelJS.Style> = {
    font: font({ size: 11 }),
    alignment: { horizontal: 'center', vertical: 'middle', shrinkToFit: true },
    border: BOX,
  };
  put(`A${labels}`, '年', labelStyle);
  put(`B${labels}`, '月', labelStyle);
  put(`C${labels}`, 'ID', labelStyle);
  put(`H${labels}`, '氏名', labelStyle);
  put(`A${values}`, year, valueStyle);
  put(`B${values}`, monthNumber, valueStyle);
  put(`C${values}`, staff.staffEmail, valueStyle);
  put(`H${values}`, staff.staffName, { ...valueStyle, font: font({ size: 12, bold: true }) });
  for (const row of [labels, values]) {
    ws.mergeCells(`C${row}:G${row}`);
    ws.mergeCells(`H${row}:L${row}`);
  }
  // 凡例(テンプレートの「＊凡例」と同じ考え方の色分け)
  put(`N${labels}`, '＊凡例', { font: font() });
  const legend: [string, SheetColumnRole, string][] = [
    ['O', 'calendar', 'カレンダーの予定から入る列(画面で直せる)'],
    ['U', 'manual', '画面で手入力する列'],
    ['Y', 'formula', '計算式(Excel が計算する)'],
  ];
  for (const [col, role, text] of legend) {
    put(`${col}${labels}`, '', { fill: fill(ROLE_FILL[role]), border: BOX });
    const next = String.fromCharCode(col.charCodeAt(0) + 1);
    put(`${next}${labels}`, text, { font: font({ size: 9 }) });
  }
}

function writeColumnHeaders(ws: ExcelJS.Worksheet): void {
  const row = ws.getRow(ATTENDANCE_SHEET_ROWS.columnHeaders);
  row.height = 48;
  for (const column of ATTENDANCE_SHEET_COLUMNS) {
    const cell = ws.getCell(`${column.letter}${ATTENDANCE_SHEET_ROWS.columnHeaders}`);
    cell.value = column.header;
    cell.style = {
      font: font({ bold: true, size: 9 }),
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      fill: fill(ROLE_FILL[column.role]),
      border: BOX,
    };
  }
}

function dayCellValue(
  column: AttendanceSheetColumn,
  businessDate: string,
  rowData: AttendanceExportMonth['month']['days'][number]['rowData'],
  row: number,
  context: SheetFormulaContext,
): ExcelJS.CellValue {
  if (column.formula) return { formula: column.formula(row, context) };
  if (column.kind === 'date') return excelDate(businessDate);
  if (column.kind === 'weekday') return weekdayOf(businessDate);
  return sheetInputValue(column, rowData);
}

function writeDays(ws: ExcelJS.Worksheet, month: AttendanceExportMonth, layout: SheetLayout): void {
  const context = formulaContext(layout);
  month.month.days.forEach((day, index) => {
    const row = layout.firstDay + index;
    const weekday = weekdayOf(day.businessDate);
    const weekendColor = weekday === '日' ? 'FFCC0000' : weekday === '土' ? 'FF1155CC' : undefined;
    for (const column of ATTENDANCE_SHEET_COLUMNS) {
      const cell = ws.getCell(`${column.letter}${row}`);
      cell.value = dayCellValue(column, day.businessDate, day.rowData, row, context);
      const isDateColumn = column.role === 'date';
      cell.style = {
        font: font(isDateColumn && weekendColor ? { color: { argb: weekendColor } } : {}),
        alignment: {
          horizontal: column.kind === 'text' ? 'left' : 'center',
          vertical: 'middle',
          shrinkToFit: column.kind === 'text',
        },
        border: GRID,
        ...(column.formula
          ? { fill: fill(FORMULA_CELL_FILL) }
          : isDateColumn
            ? { fill: fill(ROLE_FILL.date) }
            : {}),
        numFmt: numberFormat(column.kind, Boolean(column.formula)),
      };
    }
  });
}

function writeTotals(ws: ExcelJS.Worksheet, layout: SheetLayout): void {
  const row = layout.totals;
  ws.getCell(`A${row}`).value = '合計';
  ws.mergeCells(`A${row}:C${row}`);
  for (const column of ATTENDANCE_SHEET_COLUMNS) {
    const cell = ws.getCell(`${column.letter}${row}`);
    if (column.sumInTotals) {
      cell.value = { formula: `SUM(${column.letter}${layout.firstDay}:${column.letter}${layout.lastDay})` };
    }
    cell.style = {
      font: font({ bold: true }),
      alignment: { horizontal: 'center', vertical: 'middle' },
      fill: fill(TOTALS_FILL),
      border: { ...BOX, top: { style: 'medium', color: { argb: 'FF666666' } } },
      numFmt: column.sumInTotals ? numberFormat(column.kind, false) : 'General',
    };
  }
  const note = ws.getCell(`A${layout.note}`);
  note.value =
    '＊訪問等回数は、#1~#3訪問先等をカウント（MTG等を含む）。時間の列の単位は分(移動・残業・働いた時間は小数になることがあります)。';
  note.style = { font: font({ size: 9, color: { argb: 'FF34A853' } }) };
}

function writeSummary(ws: ExcelJS.Worksheet, layout: SheetLayout): void {
  const title = ws.getCell(`A${layout.summaryTitle}`);
  title.value = '月の集計';
  title.style = { font: font({ bold: true, size: 12 }) };
  const labelStyle = (argb: string): Partial<ExcelJS.Style> => ({
    font: font({ bold: true }),
    alignment: { horizontal: 'left', vertical: 'middle' },
    fill: fill(argb),
    border: BOX,
  });
  const valueStyle = (kind: SheetCellKind): Partial<ExcelJS.Style> => ({
    font: font({ bold: true, size: 11 }),
    alignment: { horizontal: 'right', vertical: 'middle' },
    border: BOX,
    numFmt: numberFormat(kind, false),
  });
  const writeItem = (row: number, label: string, formula: string, kind: SheetCellKind, labelFill: string) => {
    ws.getCell(`A${row}`).value = label;
    ws.mergeCells(`A${row}:E${row}`);
    ws.getCell(`A${row}`).style = labelStyle(labelFill);
    const value = ws.getCell(`F${row}`);
    value.value = { formula };
    value.style = valueStyle(kind);
    ws.mergeCells(`F${row}:G${row}`);
    if (kind === 'minutes' || kind === 'minutesDecimal') {
      // 分を「時間:分」でも見せる
      const hm = ws.getCell(`H${row}`);
      hm.value = { formula: `F${row}/1440` };
      hm.style = { font: font(), alignment: { horizontal: 'right' }, numFmt: '[h]:mm' };
      ws.getCell(`I${row}`).value = '(時間:分)';
      ws.getCell(`I${row}`).style = { font: font({ size: 9, color: { argb: 'FF666666' } }) };
    }
  };
  ATTENDANCE_SHEET_SUMMARY_ITEMS.forEach((item, i) => {
    writeItem(
      layout.summaryFirst + i,
      item.label,
      `${item.letter}${layout.totals}`,
      item.kind,
      ROLE_FILL.date,
    );
  });
  const { receiptDateRange, receiptAmountRange } = formulaContext(layout);
  writeItem(layout.receiptCount, '領収書の枚数', `COUNT(${receiptDateRange})`, 'count', ROLE_FILL.date);
  writeItem(layout.receiptTotal, '領収書月集計(円)', `SUM(${receiptAmountRange})`, 'yen', RECEIPT_TOTAL_FILL);
}

function writeReceipts(ws: ExcelJS.Worksheet, month: AttendanceExportMonth, layout: SheetLayout): void {
  const title = ws.getCell(`A${layout.receiptTitle}`);
  title.value = '領収書の明細';
  title.style = { font: font({ bold: true, size: 12 }) };
  const cols = RECEIPT_COLUMNS;
  const headers: [string, string, string?][] = [
    ['日付', cols.date],
    ['時刻', cols.time],
    ['お客様', cols.customer],
    ['店名', cols.store[0], cols.store[1]],
    ['金額(円)', cols.amount],
    ['申し送り', cols.handoff[0], cols.handoff[1]],
  ];
  const writeRow = (
    row: number,
    values: ExcelJS.CellValue[],
    style: (index: number) => Partial<ExcelJS.Style>,
  ): void => {
    headers.forEach(([, from, to], i) => {
      const cell = ws.getCell(`${from}${row}`);
      cell.value = values[i] ?? null;
      cell.style = style(i);
      if (to) {
        ws.mergeCells(`${from}${row}:${to}${row}`);
        ws.getCell(`${from}${row}`).style = style(i);
      }
    });
  };
  writeRow(
    layout.receiptHeader,
    headers.map(([label]) => label),
    () => ({
      font: font({ bold: true }),
      alignment: { horizontal: 'center', vertical: 'middle' },
      fill: fill(ROLE_FILL.date),
      border: BOX,
    }),
  );
  const formats = ['m/d', 'h:mm', 'General', 'General', '#,##0', 'General'];
  const aligns = ['center', 'center', 'left', 'left', 'right', 'left'] as const;
  const style = (i: number): Partial<ExcelJS.Style> => ({
    font: font(),
    alignment: { horizontal: aligns[i] ?? 'left', vertical: 'middle', shrinkToFit: i === 2 || i === 3 },
    border: GRID,
    numFmt: formats[i] as string,
  });
  if (month.receipts.length === 0) {
    writeRow(layout.receiptFirst, [null, null, 'この月の領収書はありません'], style);
    return;
  }
  month.receipts.forEach((receipt, index) => {
    writeRow(
      layout.receiptFirst + index,
      [
        excelDate(receipt.businessDate),
        excelTimeValue(receipt.time) ?? receipt.time,
        receipt.customerName,
        receipt.storeName,
        receipt.amountYen,
        receipt.handoffText,
      ],
      style,
    );
  });
}

function addMonthSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  staff: AttendanceExportStaff,
  month: AttendanceExportMonth,
): void {
  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: 'frozen', xSplit: 2, ySplit: ATTENDANCE_SHEET_ROWS.columnHeaders }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: `1:${ATTENDANCE_SHEET_ROWS.columnHeaders}`,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    },
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = ATTENDANCE_SHEET_COLUMNS.map((column) => ({ key: column.letter, width: column.width }));
  const layout = sheetLayoutOf(month.month.days.length, month.receipts.length);
  writeHeader(ws, staff, month);
  writeColumnHeaders(ws);
  writeDays(ws, month, layout);
  writeTotals(ws, layout);
  writeSummary(ws, layout);
  writeReceipts(ws, month, layout);
}

export interface AttendanceWorkbookSheet {
  /** シート名の元(Excel の決まりに直し、重なれば「(2)」を付ける)。 */
  name: string;
  staff: AttendanceExportStaff;
  month: AttendanceExportMonth;
}

/** シートの並びから .xlsx を作る。 */
export async function buildAttendanceWorkbook(
  sheets: readonly AttendanceWorkbookSheet[],
  createdAt: Date = new Date(),
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'katahimo';
  workbook.created = createdAt;
  workbook.modified = createdAt;
  // 計算式の結果は書かないので、開いたときに Excel に全て計算させる
  workbook.calcProperties.fullCalcOnLoad = true;
  const names = uniqueSheetNames(sheets.map((s) => s.name));
  sheets.forEach((sheet, i) => {
    addMonthSheet(workbook, names[i] as string, sheet.staff, sheet.month);
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** 'YYYY-MM' → '2026年9月'。 */
export function yearMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number) as [number, number];
  return `${year}年${month}月`;
}

/** 1人分(1か月: シート名は「2026年9月」、年度: 「4月」〜「3月」)。 */
export function staffWorkbookSheets(staff: AttendanceExportStaff): AttendanceWorkbookSheet[] {
  const multiple = staff.months.length > 1;
  return staff.months.map((month) => ({
    name: multiple ? `${Number(month.month.yearMonth.slice(5, 7))}月` : yearMonthLabel(month.month.yearMonth),
    staff,
    month,
  }));
}

/** 全員分(シート名はスタッフの表示名)。 */
export function allStaffWorkbookSheets(
  staffList: readonly AttendanceExportStaff[],
): AttendanceWorkbookSheet[] {
  return staffList.flatMap((staff) => staff.months.map((month) => ({ name: staff.staffName, staff, month })));
}
