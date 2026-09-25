import {
  type AttendanceCellChange,
  type AttendanceRowData,
  buildCalendarSyncPlan,
  buildRowDataFromAppointments,
  type CalendarAppointment,
  mergeOverlappingOfficeWork,
} from '../../domain/attendance';
import type { AttendanceDayRecord } from '../../ports/attendanceDays';
import {
  type AttendanceActor,
  type AttendanceTarget,
  loadAttendanceTarget,
  logCrossStaffRead,
  writeActorLog,
} from './access';
import type { CalendarSyncDeps } from './deps';
import { AttendanceError } from './errors';
import {
  encryptRowData,
  enqueueAttendanceAggregateMirror,
  enqueueAttendanceDayMirror,
  readRowData,
} from './records';

/**
 * カレンダー → 出勤簿の反映(GAS版 PastSchedule.js の previewCalendarSyncForStaffOnDate /
 * applyCalendarSyncForStaffOnDate / syncPastScheduleFromCalendar / 夜間バッチの中核処理)。
 *
 * 出勤簿は給与に直結する正式な記録なので、予定は毎回キャッシュを使わず最新のカレンダーから取る
 * (GAS版 refreshAttendanceForStaffOnDate がルート結果キャッシュを使わないのと同じ)。
 * 手入力の修正と違い、月ロックは掛けない(いつでもカレンダーの内容を反映できる)。
 */

interface StaffRef {
  staffId: string;
  staffName: string;
}

interface CalendarSnapshot {
  appointments: CalendarAppointment[];
  rowData: AttendanceRowData;
}

async function fetchCalendarRowData(
  deps: CalendarSyncDeps,
  staff: StaffRef,
  date: string,
): Promise<CalendarSnapshot> {
  const result = await deps.schedule.getScheduleWithRoute(staff.staffName, date, true);
  if (!result.success) {
    const reason = result.message ? `(${result.message})` : '';
    throw new AttendanceError('schedule_unavailable', `カレンダー予定の取得に失敗しました。${reason}`);
  }
  const appointments = mergeOverlappingOfficeWork(result.appointments ?? []);
  return { appointments, rowData: buildRowDataFromAppointments(appointments) };
}

interface ComputedSync {
  record: AttendanceDayRecord | null;
  current: AttendanceRowData;
  appointmentCount: number;
  changes: AttendanceCellChange[];
  valuesToApply: AttendanceRowData;
}

async function computeSync(
  deps: CalendarSyncDeps,
  tenantId: string,
  staff: StaffRef,
  date: string,
): Promise<ComputedSync> {
  const calendar = await fetchCalendarRowData(deps, staff, date);
  const record = await deps.attendanceDays.findByStaffAndDate(tenantId, staff.staffId, date);
  const current = await readRowData(deps, tenantId, record);
  const plan = buildCalendarSyncPlan(current, calendar.rowData);
  return {
    record,
    current,
    appointmentCount: calendar.appointments.length,
    changes: plan.changes,
    valuesToApply: plan.valuesToApply,
  };
}

export interface CalendarSyncResult {
  staffId: string;
  staffName: string;
  date: string;
  appointmentCount: number;
  changes: AttendanceCellChange[];
}

/**
 * 1スタッフ・1日分をカレンダーから反映する(権限確認済みの呼び出し元専用。API・夜間バッチの共通処理)。
 *
 * 冪等: 同じカレンダー内容で何度実行しても出勤簿は同じになり、2回目以降は changes が空になる
 * (変更が無ければ出勤簿の保存・履歴追記・個別出勤簿のミラーは行わない)。
 * 「勤怠集計」シートはGAS版と同じく毎回書き直す(移動時間・ルート等、出勤簿に無い情報も含むため)。
 *
 * @param changedByStaffId 反映を実行したスタッフ。夜間バッチはnull(システムによる自動転記)。
 */
export async function syncStaffDayFromCalendar(
  deps: CalendarSyncDeps,
  tenantId: string,
  staff: StaffRef,
  date: string,
  changedByStaffId: string | null,
): Promise<CalendarSyncResult> {
  const sync = await computeSync(deps, tenantId, staff, date);

  let record: AttendanceDayRecord;
  if (sync.changes.length > 0) {
    record = await deps.attendanceDays.save({
      tenantId,
      staffId: staff.staffId,
      businessDate: date,
      rowData: await encryptRowData(deps, tenantId, { ...sync.current, ...sync.valuesToApply }),
      // カレンダーからの反映は「手で変更された列」を増やしも消しもしない(GAS版もセルの背景色はそのまま)。
      changedFields: sync.record?.changedFields ?? [],
      lastChangedByStaffId: changedByStaffId ?? sync.record?.lastChangedByStaffId ?? null,
      history: {
        changedByStaffId,
        changedFields: sync.changes.map((c) => c.column),
        previousRowData: sync.record?.rowData ?? null,
      },
    });
    await enqueueAttendanceDayMirror(deps, tenantId, record.id);
  } else {
    record =
      sync.record ??
      (await deps.attendanceDays.findOrCreate(
        tenantId,
        staff.staffId,
        date,
        await encryptRowData(deps, tenantId, {}),
      ));
  }
  await enqueueAttendanceAggregateMirror(deps, tenantId, record.id);

  return {
    staffId: staff.staffId,
    staffName: staff.staffName,
    date,
    appointmentCount: sync.appointmentCount,
    changes: sync.changes,
  };
}

async function logSyncFailure(
  deps: CalendarSyncDeps,
  actor: AttendanceActor,
  target: AttendanceTarget | null,
  action: string,
  date: string,
  error: unknown,
): Promise<void> {
  await writeActorLog(deps, actor, target, {
    level: 'ERROR',
    action,
    details: { date, error: error instanceof Error ? error.message : String(error) },
  });
}

export interface CalendarSyncPreview {
  staffId: string;
  staffName: string;
  date: string;
  appointmentCount: number;
  hasChanges: boolean;
  changes: AttendanceCellChange[];
}

/** 「カレンダーから反映」の確認用: 何も書き込まず、反映した場合に変わるセルだけを返す。 */
export async function previewCalendarSync(
  deps: CalendarSyncDeps,
  actor: AttendanceActor,
  targetStaffId: string,
  date: string,
): Promise<CalendarSyncPreview> {
  const target = await loadAttendanceTarget(deps, actor, targetStaffId);
  try {
    const sync = await computeSync(deps, actor.tenantId, target, date);
    // 予定の取得(Maps計算を伴う)はコストがあるため、他スタッフ分の操作は記録する。
    await logCrossStaffRead(deps, actor, target, 'attendance.calendar_sync.preview', {
      date,
      appointmentCount: sync.appointmentCount,
      changedCount: sync.changes.length,
    });
    return {
      staffId: target.staffId,
      staffName: target.staffName,
      date,
      appointmentCount: sync.appointmentCount,
      hasChanges: sync.changes.length > 0,
      changes: sync.changes,
    };
  } catch (error) {
    await logSyncFailure(deps, actor, target, 'attendance.calendar_sync.preview_failed', date, error);
    throw error;
  }
}

/**
 * プレビュー確認後の反映。クライアントが見た差分は信用せず、書き込み時に同じ計算をやり直す
 * (その間にカレンダー・出勤簿が変わっていれば最新の状態を反映する)。
 */
export async function applyCalendarSync(
  deps: CalendarSyncDeps,
  actor: AttendanceActor,
  targetStaffId: string,
  date: string,
): Promise<CalendarSyncResult> {
  const target = await loadAttendanceTarget(deps, actor, targetStaffId);
  try {
    const result = await syncStaffDayFromCalendar(deps, actor.tenantId, target, date, actor.staffId);
    await writeActorLog(deps, actor, target, {
      level: 'INFO',
      action: 'attendance.calendar_sync.apply',
      details: { date, appointmentCount: result.appointmentCount, changedCount: result.changes.length },
    });
    return result;
  } catch (error) {
    await logSyncFailure(deps, actor, target, 'attendance.calendar_sync.apply_failed', date, error);
    throw error;
  }
}

export interface AttendanceAggregateRefreshResult {
  staffId: string;
  staffName: string;
  date: string;
  appointmentCount: number;
  rowData: AttendanceRowData;
}

/**
 * 管理者専用: 「勤怠集計」シートの該当スタッフ・該当日の行をカレンダーから書き直す
 * (GAS版 refreshAttendanceForStaffOnDate)。個別の出勤簿は書き換えない。
 */
export async function refreshAttendanceAggregate(
  deps: CalendarSyncDeps,
  actor: AttendanceActor,
  targetStaffId: string,
  date: string,
): Promise<AttendanceAggregateRefreshResult> {
  if (!actor.isAdmin) {
    await writeActorLog(deps, actor, null, {
      level: 'WARN',
      action: 'attendance.aggregate.refresh_denied',
      details: { date, requestedStaffId: targetStaffId },
    });
    throw new AttendanceError('forbidden', 'この操作には管理者権限が必要です。');
  }
  const target = await loadAttendanceTarget(deps, actor, targetStaffId);
  try {
    const calendar = await fetchCalendarRowData(deps, target, date);
    const record = await deps.attendanceDays.findOrCreate(
      actor.tenantId,
      target.staffId,
      date,
      await encryptRowData(deps, actor.tenantId, {}),
    );
    await enqueueAttendanceAggregateMirror(deps, actor.tenantId, record.id);
    await writeActorLog(deps, actor, target, {
      level: 'INFO',
      action: 'attendance.aggregate.refresh',
      details: { date, appointmentCount: calendar.appointments.length },
    });
    return {
      staffId: target.staffId,
      staffName: target.staffName,
      date,
      appointmentCount: calendar.appointments.length,
      rowData: calendar.rowData,
    };
  } catch (error) {
    await logSyncFailure(deps, actor, target, 'attendance.aggregate.refresh_failed', date, error);
    throw error;
  }
}
