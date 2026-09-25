import { randomUUID } from 'node:crypto';
import type { AttendanceRowData } from '../../domain/attendance';
import type { AttendanceDayRecord } from '../../ports/attendanceDays';
import type { EncryptedField } from '../../ports/repositories';
import type { AttendanceDeps } from './deps';

/** 保存済みの行を復号する。レコードが無い日は空の行(すべて未入力)。 */
export async function readRowData(
  deps: Pick<AttendanceDeps, 'crypto'>,
  tenantId: string,
  record: AttendanceDayRecord | null,
): Promise<AttendanceRowData> {
  if (!record) return {};
  return JSON.parse(await deps.crypto.decrypt(tenantId, record.rowData)) as AttendanceRowData;
}

export function encryptRowData(
  deps: Pick<AttendanceDeps, 'crypto'>,
  tenantId: string,
  rowData: AttendanceRowData,
): Promise<EncryptedField> {
  return deps.crypto.encrypt(tenantId, JSON.stringify(rowData));
}

/** 個別出勤簿スプレッドシートの該当日の行へのミラーを積む(ワーカーが最新値を読み直して送る)。 */
export function enqueueAttendanceDayMirror(
  deps: Pick<AttendanceDeps, 'mirror'>,
  tenantId: string,
  attendanceDayId: string,
): Promise<void> {
  return deps.mirror.enqueue({
    tenantId,
    kind: 'attendance_day',
    targetId: attendanceDayId,
    idempotencyKey: randomUUID(),
  });
}

/** 「勤怠集計」スプレッドシートの該当スタッフ・該当日の行の書き直しを積む。 */
export function enqueueAttendanceAggregateMirror(
  deps: Pick<AttendanceDeps, 'mirror'>,
  tenantId: string,
  attendanceDayId: string,
): Promise<void> {
  return deps.mirror.enqueue({
    tenantId,
    kind: 'attendance_aggregate',
    targetId: attendanceDayId,
    idempotencyKey: randomUUID(),
  });
}
