import {
  type AttendanceDayDerived,
  type AttendanceRowData,
  type AttendanceRowPatch,
  applyRowEdit,
  type CellChange,
  changedSheetColumns,
  checkAttendanceEditable,
  compactRowData,
  computeDayDerived,
  DomainError,
  editableRangeFor,
  isWithinEditableRange,
  newId,
  projectDay,
  WEATHER_OPTIONS,
  zonedBusinessDate,
} from '../../domain';
import type { AttendanceDayRows } from '../../ports/attendance';
import type { TenantRepositories } from '../../ports/unitOfWork';
import type { Actor } from '../requestMeta';
import { currentTime } from '../requestMeta';
import { type AttendanceTarget, loadAttendanceTarget, logCrossStaffRead, writeActorLog } from './access';
import type { AttendanceDeps } from './deps';
import { enqueueAttendanceDayMirror, toSheetDay, writeSheetDiff } from './records';

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
  /** 楽観的排他の版(記録の無い日は0)。保存のときに送り返すと、他の人の保存と重なった場合に 409 になる。 */
  rowVersion: number;
  editable: boolean;
  editableFrom: string;
  editableTo: string;
  /** 天候の選択肢(#1後 / #2後)。 */
  optionsI: string[];
  optionsR: string[];
}

export async function buildDayView(
  deps: AttendanceDeps,
  r: TenantRepositories,
  target: AttendanceTarget,
  rows: AttendanceDayRows,
  today: string,
): Promise<AttendanceDayView> {
  const timeZone = (await r.tenant()).timezone;
  const sheet = await toSheetDay(deps.crypto, r.tenantId, timeZone, rows);
  const projection = projectDay(sheet);
  if (projection.hiddenVisitCount > 0) {
    await deps.appLog.write({
      tenantId: r.tenantId,
      level: 'WARN',
      action: 'attendance.day.hidden_visits',
      targetStaffId: target.staffId,
      details: { businessDate: rows.businessDate, hiddenVisitCount: projection.hiddenVisitCount },
    });
  }
  const rowData = compactRowData(projection.rowData);
  const range = editableRangeFor(today);
  return {
    businessDate: rows.businessDate,
    staffId: target.staffId,
    staffName: target.staffName,
    found: rows.day !== null,
    rowData,
    derived: computeDayDerived(rowData),
    changedFields: projection.changedFields,
    rowVersion: rows.day?.rowVersion ?? 0,
    editable: isWithinEditableRange(rows.businessDate, range),
    editableFrom: range.from,
    editableTo: range.to,
    optionsI: [...WEATHER_OPTIONS],
    optionsR: [...WEATHER_OPTIONS],
  };
}

async function todayOf(deps: AttendanceDeps, r: TenantRepositories): Promise<string> {
  return zonedBusinessDate(currentTime(deps), (await r.tenant()).timezone);
}

/** 指定スタッフ・指定日の出勤簿1日分(入力列+派生値+編集可否)。 */
export async function getAttendanceDay(
  deps: AttendanceDeps,
  actor: Actor,
  targetStaffId: string,
  businessDate: string,
): Promise<AttendanceDayView> {
  const { view, target } = await deps.uow.run(actor.tenantId, async (r) => {
    const target = await loadAttendanceTarget(r, actor, targetStaffId);
    const rows = await r.attendance.loadDay(target.staffId, businessDate);
    return { view: await buildDayView(deps, r, target, rows, await todayOf(deps, r)), target };
  });
  await logCrossStaffRead(deps.appLog, actor, target, 'attendance.day.view', {
    businessDate,
    found: view.found,
  });
  return view;
}

export interface UpdateAttendanceDayResult {
  attendance: AttendanceDayView;
  changes: CellChange[];
  message: string;
}

/**
 * 出勤簿1日分を手入力で修正する(GAS版 updatePastSchedule)。
 * - 当月(テナントのタイムゾーン)以外の日付は、管理者を含め誰も修正できない(locked)。
 * - 送られた列だけを比べ、値が変わった列だけを実体に書く。変更が無ければ何も保存しない。
 * - 変えた項目は実体の overridden_fields に加え(スプレッドシートで強調表示)、変更前の値を entity_changes に残す。
 * - 読み→書きはその日の行を押さえた1トランザクション(カレンダー反映と重ならない)。expectedVersion を
 *   送れば、画面を開いた後に他の人が保存していた場合に 409 conflict になる。
 */
export async function updateAttendanceDay(
  deps: AttendanceDeps,
  actor: Actor,
  targetStaffId: string,
  businessDate: string,
  patch: AttendanceRowPatch,
  expectedVersion?: number,
): Promise<UpdateAttendanceDayResult> {
  try {
    const result = await deps.uow.run(
      actor.tenantId,
      async (r) => {
        const today = await todayOf(deps, r);
        const editCheck = checkAttendanceEditable(businessDate, today);
        if (!editCheck.editable)
          throw new DomainError('locked', editCheck.message, undefined, editCheck.reason);
        const target = await loadAttendanceTarget(r, actor, targetStaffId);
        const timeZone = (await r.tenant()).timezone;
        // 変更が無ければ何も書かない(入れ物の行も作らない)。変更があるときだけ行を押さえて読み直してから書く
        const preview = await r.attendance.loadDay(target.staffId, businessDate);
        const previewSheet = await toSheetDay(deps.crypto, r.tenantId, timeZone, preview);
        if (applyRowEdit(previewSheet, patch, { source: 'user', newId }).changes.length === 0) {
          return { target, changes: [], attendance: await buildDayView(deps, r, target, preview, today) };
        }
        const rows = await r.attendance.lockDay(target.staffId, businessDate, newId());
        const currentVersion = rows.existed ? rows.day.rowVersion : 0;
        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
          throw new DomainError(
            'conflict',
            '他の人(または別の画面)が先にこの日の出勤簿を保存しました。画面を開き直してから、もう一度修正してください。',
            undefined,
            'stale_row_version',
          );
        }
        const current = await toSheetDay(deps.crypto, r.tenantId, timeZone, rows);
        const { next, changes } = applyRowEdit(current, patch, { source: 'user', newId });
        const saved = await writeSheetDiff(
          r,
          { crypto: deps.crypto, timeZone, changedBy: actor.staffId, changeSource: 'user' },
          rows,
          current,
          next,
        );
        if (saved) await enqueueAttendanceDayMirror(r, saved, changedSheetColumns(current, next));
        const after = saved ? await r.attendance.loadDay(target.staffId, businessDate) : rows;
        return { target, changes, attendance: await buildDayView(deps, r, target, after, today) };
      },
      { actorId: actor.staffId },
    );
    await writeActorLog(deps.appLog, actor, result.target, {
      level: 'INFO',
      action: 'attendance.day.update',
      details: {
        businessDate,
        changedCount: result.changes.length,
        changedColumns: result.changes.map((c) => c.column),
      },
    });
    return {
      attendance: result.attendance,
      changes: result.changes,
      message: result.changes.length > 0 ? '修正しました。' : '変更はありませんでした。',
    };
  } catch (error) {
    if (error instanceof DomainError && (error.code === 'locked' || error.code === 'conflict')) {
      await writeActorLog(deps.appLog, actor, null, {
        level: 'WARN',
        action: error.code === 'locked' ? 'attendance.day.update_locked' : 'attendance.day.update_conflict',
        details: { businessDate, reason: error.reason ?? null, requestedStaffId: targetStaffId },
      });
    }
    throw error;
  }
}
