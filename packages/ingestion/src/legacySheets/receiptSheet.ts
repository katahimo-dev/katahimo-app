import { driveFileIdOfLink } from '@katahimo/core/domain';
import type { LegacySheet, LegacySheetCell } from '@katahimo/core/ports';
import type { LegacyReceiptRow, LegacySheetRows } from '@katahimo/core/usecases';
import { cellAmount, cellAt, cellId, cellText, cellTrimmed, cellWallClock, isBlankRow } from './cells';

/**
 * GAS版の「領収書一覧」(先頭のシート)の列(0始まり)。Main.js processReceiptImages と Bridge.js bridgeWriteReceipt_ が
 * 書く並び(日時, ユーザーID, 顧客ID, 顧客名, 金額, 名称, Googleドライブ写真ファイルへのリンク, 申し送り, KatahimoReceiptId)。
 */
const RECEIPT_COLUMNS = {
  timestamp: 0,
  staffName: 1,
  customerId: 2,
  customerName: 3,
  amount: 4,
  storeName: 5,
  imageLink: 6,
  handoffText: 7,
  katahimoReceiptId: 8,
} as const;

/** GAS版の「領収書一覧」を読む。行を指すキーは画像の Drive のファイル ID(同じ画像の2行目以降は重複として除く)。 */
export function parseReceiptSheet(sheet: LegacySheet): LegacySheetRows<LegacyReceiptRow> {
  const first = sheet.rows[0];
  if (first && cellTrimmed(cellAt(first, 0)) !== '日時') {
    throw new Error(`「${sheet.title}」の1行目が GAS版の領収書一覧の見出し(日時 …)ではありません`);
  }
  const source = 'gas_receipt';
  const result: LegacySheetRows<LegacyReceiptRow> = { rows: [], issues: [], blankRowCount: 0 };
  const seenFiles = new Set<string>();
  for (const [index, cells] of sheet.rows.entries()) {
    if (index === 0) continue;
    const rowNumber = index + 1;
    if (isBlankRow(cells)) {
      result.blankRowCount++;
      continue;
    }
    const reason = rowProblemOf(cells, seenFiles);
    if (typeof reason === 'string') {
      result.issues.push({ source, rowNumber, reason });
      continue;
    }
    const { timestamp, fileId } = reason;
    seenFiles.add(fileId);
    result.rows.push({
      source,
      rowNumber,
      sourceKey: fileId,
      timestamp,
      staffName: cellTrimmed(cellAt(cells, RECEIPT_COLUMNS.staffName)),
      customerExternalId: cellId(cellAt(cells, RECEIPT_COLUMNS.customerId)),
      customerName: cellTrimmed(cellAt(cells, RECEIPT_COLUMNS.customerName)),
      amount: cellAmount(cellAt(cells, RECEIPT_COLUMNS.amount)),
      storeName: cellTrimmed(cellAt(cells, RECEIPT_COLUMNS.storeName)),
      handoffText: cellText(cellAt(cells, RECEIPT_COLUMNS.handoffText)),
    });
  }
  return result;
}

/** 取り込めない行の理由、取り込める行は日時と画像のファイル ID。 */
function rowProblemOf(
  cells: readonly LegacySheetCell[],
  seenFiles: ReadonlySet<string>,
):
  | 'from_app'
  | 'invalid_timestamp'
  | 'image_link_missing'
  | 'duplicate'
  | { timestamp: string; fileId: string } {
  if (cellTrimmed(cellAt(cells, RECEIPT_COLUMNS.katahimoReceiptId))) return 'from_app';
  const timestamp = cellWallClock(cellAt(cells, RECEIPT_COLUMNS.timestamp));
  if (!timestamp) return 'invalid_timestamp';
  const fileId = driveFileIdOfLink(cellTrimmed(cellAt(cells, RECEIPT_COLUMNS.imageLink)));
  if (!fileId) return 'image_link_missing';
  return seenFiles.has(fileId) ? 'duplicate' : { timestamp, fileId };
}
