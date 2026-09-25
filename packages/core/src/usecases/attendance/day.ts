import {
  type AttendanceCellChange,
  type AttendanceDayDerived,
  type AttendanceRowData,
  applyRowPatch,
  checkAttendanceEditable,
  computeDayDerived,
  editableRangeFor,
  isWithinEditableRange,
  mergeChangedFields,
  WEATHER_OPTIONS,
} from '../../domain/attendance';
import { jstBusinessDate } from '../../domain/calendarDate';
import type { AttendanceDayRecord } from '../../ports/attendanceDays';
import {
  type AttendanceActor,
  type AttendanceTarget,
  loadAttendanceTarget,
  logCrossStaffRead,
  writeActorLog,
} from './access';
import { currentTime } from './clock';
import type { AttendanceDeps } from './deps';
import { AttendanceError } from './errors';
import { encryptRowData, enqueueAttendanceDayMirror, readRowData } from './records';

/** 出勤簿1日分の閲覧・編集画面用のビュー(GAS版 getPastScheduleForDate の戻り値に相当)。 */
export interface AttendanceDayView {
  businessDate: string;
  staffId: string;
  staffName: string;
  /** 記録が存在するか。無い日は rowData が空。 */
  found: boolean;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
  changedFields: string[];
  editable: boolean;
  editableFrom: string;
  editableTo: string;
  /** 天候の選択肢(#1後 / #2後)。 */
  optionsI: string[];
  optionsR: string[];
}

function toDayView(
  target: AttendanceTarget,
  businessDate: string,
  record: AttendanceDayRecord | null,
  rowData: AttendanceRowData,
  today: string,
): AttendanceDayView {
  const range = editableRangeFor(today);
  return {
    businessDate,
    staffId: target.staffId,
    staffName: target.staffName,
    found: record !== null,
    rowData,
    derived: computeDayDerived(rowData),
    changedFields: record?.changedFields ?? [],
    editable: isWithinEditableRange(businessDate, range),
    editableFrom: range.from,
    editableTo: range.to,
    optionsI: [...WEATHER_OPTIONS],
    optionsR: [...WEATHER_OPTIONS],
  };
}

/** 指定スタッフ・指定日の出勤簿1日分(入力列+派生値+編集可否)。 */
export async function getAttendanceDay(
  deps: AttendanceDeps,
  actor: AttendanceActor,
  targetStaffId: string,
  businessDate: string,
): Promise<AttendanceDayView> {
  const target = await loadAttendanceTarget(deps, actor, targetStaffId);
  const record = await deps.attendanceDays.findByStaffAndDate(actor.tenantId, target.staffId, businessDate);
  const rowData = await readRowData(deps, actor.tenantId, record);
  await logCrossStaffRead(deps, actor, target, 'attendance.day.view', {
    businessDate,
    found: record !== null,
  });
  return toDayView(target, businessDate, record, rowData, jstBusinessDate(currentTime(deps)));
}

export interface UpdateAttendanceDayResult {
  attendance: AttendanceDayView;
  changes: AttendanceCellChange[];
  message: string;
}

/**
 * 出勤簿1日分を手入力で修正する(GAS版 updatePastSchedule)。
 *
 * - 当月(JST)以外の日付は、管理者を含め誰も修正できない(AttendanceError 'locked')。
 * - 送られてきた列だけを比較し、値が変わった列だけを書き込む。変更が無ければ何も保存しない。
 * - 変わった列は changed_fields に加え(ミラー時にセルを強調表示する)、変更前の行を履歴に残す。
 */
export async function updateAttendanceDay(
  deps: AttendanceDeps,
  actor: AttendanceActor,
  targetStaffId: string,
  businessDate: string,
  patch: AttendanceRowData,
): Promise<UpdateAttendanceDayResult> {
  const today = jstBusinessDate(currentTime(deps));
  const editCheck = checkAttendanceEditable(businessDate, today);
  if (!editCheck.editable) {
    await writeActorLog(deps, actor, null, {
      level: 'WARN',
      action: 'attendance.day.update_locked',
      details: { businessDate, reason: editCheck.reason, requestedStaffId: targetStaffId },
    });
    throw new AttendanceError('locked', editCheck.message);
  }

  const target = await loadAttendanceTarget(deps, actor, targetStaffId);
  const record = await deps.attendanceDays.findByStaffAndDate(actor.tenantId, target.staffId, businessDate);
  const current = await readRowData(deps, actor.tenantId, record);
  const { next, changes } = applyRowPatch(current, patch);

  let saved = record;
  if (changes.length > 0) {
    const changedColumns = changes.map((c) => c.column);
    saved = await deps.attendanceDays.save({
      tenantId: actor.tenantId,
      staffId: target.staffId,
      businessDate,
      rowData: await encryptRowData(deps, actor.tenantId, next),
      changedFields: mergeChangedFields(record?.changedFields ?? [], changedColumns),
      lastChangedByStaffId: actor.staffId,
      history: {
        changedByStaffId: actor.staffId,
        changedFields: changedColumns,
        previousRowData: record?.rowData ?? null,
      },
    });
    await enqueueAttendanceDayMirror(deps, actor.tenantId, saved.id);
  }

  await writeActorLog(deps, actor, target, {
    level: 'INFO',
    action: 'attendance.day.update',
    details: { businessDate, changedCount: changes.length, changedColumns: changes.map((c) => c.column) },
  });

  return {
    attendance: toDayView(target, businessDate, saved, changes.length > 0 ? next : current, today),
    changes,
    message: changes.length > 0 ? '修正しました。' : '変更はありませんでした。',
  };
}
