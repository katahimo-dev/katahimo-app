import { type AttendanceRowPatch, applyRowEdit, DomainError, newId } from '../../domain';
import type { AttendanceDeps } from './deps';
import { toSheetDay, writeSheetDiff } from './records';

/** 既存の出勤簿(スプレッドシート)の1日分の行。 */
export interface AttendanceSheetImportRow {
  /** 元のCSVの行番号(1始まり。結果の表示用)。 */
  rowNumber: number;
  /** 'YYYY-MM-DD'。 */
  businessDate: string;
  /** 出勤簿の入力列の値(列記号 → 値。空のセルは '')。 */
  rowData: AttendanceRowPatch;
}

export interface AttendanceSheetImportResult {
  /** 実体を書いた日の数。 */
  imported: number;
  /** 既に同じ内容だった(または空の)日の数。 */
  unchanged: number;
  /** 形式の読めないセル(そのセルだけ取り込まなかった)。 */
  skippedCells: { rowNumber: number; column: string; message: string }[];
  /** 取り込めなかった日(締めた月等)。 */
  failed: { rowNumber: number; businessDate: string; message: string }[];
}

/**
 * 既存の出勤簿の行を、1日ずつ実体(attendance_days・visits・work_segments・travel_legs)に取り込む(本番への切り替え前に、
 * 当月分の出勤簿の内容を DB に揃えるための運用の処理。doc/11 §7)。
 * - 1日ずつ別のトランザクション(1日の失敗で他の日を止めない)。値の変わった列だけを書き、変更前の値を
 *   entity_changes(change_source = 'import')に残す。同じ内容の再実行は何も書かない(冪等)。
 * - 画面の手入力と違い当月の編集期限は掛けない(締めた月は DB のトリガーが拒否し、failed に入る)。
 * - スプレッドシートへのミラーは積まない(元がスプレッドシートのため)。CSV には背景色が無いため、手で変えた
 *   強調表示は取り込まない。
 * - 形式の読めないセル(時刻でない値等)はそのセルだけ飛ばして skippedCells に残す。
 */
export async function importAttendanceSheetRows(
  deps: AttendanceDeps,
  tenantId: string,
  staffId: string,
  rows: AttendanceSheetImportRow[],
): Promise<AttendanceSheetImportResult> {
  const result: AttendanceSheetImportResult = { imported: 0, unchanged: 0, skippedCells: [], failed: [] };
  for (const row of rows) {
    const patch: AttendanceRowPatch = { ...row.rowData };
    try {
      const written = await deps.uow.run(tenantId, async (r) => {
        const timeZone = (await r.tenant()).timezone;
        const preview = await toSheetDay(
          deps.crypto,
          tenantId,
          timeZone,
          await r.attendance.loadDay(staffId, row.businessDate),
        );
        // 読めないセルを除いてから当てる(そのセルだけ飛ばす)
        for (;;) {
          try {
            if (applyRowEdit(preview, patch, { source: 'import', newId }).changes.length === 0) return false;
            break;
          } catch (error) {
            const fields = error instanceof DomainError ? Object.keys(error.fields ?? {}) : [];
            if (fields.length === 0) throw error;
            for (const field of fields) {
              const column = field.replace(/^rowData\./, '') as keyof AttendanceRowPatch;
              result.skippedCells.push({
                rowNumber: row.rowNumber,
                column,
                message:
                  error instanceof DomainError ? (error.fields?.[field] ?? error.message) : String(error),
              });
              delete patch[column];
            }
          }
        }
        const locked = await r.attendance.lockDay(staffId, row.businessDate, newId());
        const current = await toSheetDay(deps.crypto, tenantId, timeZone, locked);
        const { next } = applyRowEdit(current, patch, { source: 'import', newId });
        await writeSheetDiff(
          r,
          { crypto: deps.crypto, timeZone, changedBy: null, changeSource: 'import' },
          locked,
          current,
          next,
        );
        return true;
      });
      if (written) result.imported++;
      else result.unchanged++;
    } catch (error) {
      result.failed.push({
        rowNumber: row.rowNumber,
        businessDate: row.businessDate,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await deps.appLog.write({
    tenantId,
    level: result.failed.length > 0 || result.skippedCells.length > 0 ? 'WARN' : 'INFO',
    action: 'attendance.sheet_import.done',
    actorType: 'system',
    targetStaffId: staffId,
    details: {
      imported: result.imported,
      unchanged: result.unchanged,
      skippedCells: result.skippedCells.length,
      failed: result.failed.length,
    },
  });
  return result;
}
