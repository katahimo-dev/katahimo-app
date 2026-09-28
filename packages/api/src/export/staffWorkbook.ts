import type { StaffSheet, StaffSheetExport } from '@katahimo/core/domain';
import { STAFF_SHEET_COLUMNS } from '@katahimo/shared';
import { buildXlsxWorkbook, readXlsxSheets } from './xlsxSheets';

/**
 * 管理画面「スタッフ」の xlsx を読む・書く(POST /api/admin/staff/import・GET /api/admin/staff/export.xlsx)。
 * シートの読み取り・値の解釈は core の staffSheet.ts(ここはセルの値を取り出す・表を書くだけ)。
 */

/** 読むシート・行・列の上限(スタッフは STAFF_IMPORT_MAX_ROWS 行まで。行の数の誤りは core が返す)。 */
const LIMITS = { maxSheets: 20, maxRows: 2000, maxColumns: 40 } as const;

/** 文字の書式にする列(電話の先頭の 0・退職日の「YYYY-MM-DD」を Excel が数・日付に変えないように)。 */
const TEXT_COLUMNS = STAFF_SHEET_COLUMNS.flatMap((c, index) =>
  c.key === 'phone' || c.key === 'retiredOn' || c.key === 'id' ? [index] : [],
);

export function readStaffWorkbook(body: Buffer): Promise<StaffSheet[]> {
  return readXlsxSheets(body, LIMITS);
}

export function buildStaffWorkbook(sheet: StaffSheetExport): Promise<Buffer> {
  return buildXlsxWorkbook([{ ...sheet, textColumns: TEXT_COLUMNS }]);
}
