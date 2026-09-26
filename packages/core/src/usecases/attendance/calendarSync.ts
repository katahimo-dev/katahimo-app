import { createHash } from 'node:crypto';
import {
  type AttendanceRowData,
  type AttendanceSheetDay,
  applyRowEdit,
  buildCalendarSyncPlan,
  buildRowDataFromAppointments,
  type CalendarAppointment,
  type CellChange,
  canonicalizeRowData,
  changedSheetColumns,
  compactRowData,
  DomainError,
  forbidden,
  isAdminRole,
  mergeOverlappingOfficeAppointments,
  newId,
  parseTimeToMinutes,
  projectDay,
  SHEET_VISIT_SLOT_COUNT,
  visitAppointmentsInSlotOrder,
} from '../../domain';
import type { ScheduleAppointmentWithRoute } from '../../ports/schedule';
import type { TenantRepositories } from '../../ports/unitOfWork';
import type { Actor } from '../requestMeta';
import { getFreshScheduleWithRouteForStaff } from '../schedule';
import { type AttendanceTarget, loadAttendanceTarget, logCrossStaffRead, writeActorLog } from './access';
import type { CalendarSyncDeps } from './deps';
import {
  enqueueAttendanceAggregateMirror,
  enqueueAttendanceDayMirror,
  toSheetDay,
  writeSheetDiff,
} from './records';

/**
 * カレンダー → 出勤簿の反映(GAS版 PastSchedule.js の previewCalendarSyncForStaffOnDate /
 * applyCalendarSyncForStaffOnDate / 夜間バッチの中核)。
 *
 * 出勤簿は給与に直結する正式な記録なので、予定は毎回キャッシュを使わず最新のカレンダーから取る
 * (getFreshScheduleWithRouteForStaff)。手入力の修正と違い、当月の編集期限は掛けない(GAS版と同じ)。
 * どの枠に何を書き何を残すかは GAS版を移植した buildCalendarSyncPlan が出勤簿の行の形で決め、
 * 実体(visits / work_segments / travel_legs)への書き込みは applyRowEdit が行う。出勤簿の枠(3つ)に
 * 載らない4件目以降の訪問も visits には保存する。
 */

type RouteAppointment = ScheduleAppointmentWithRoute & CalendarAppointment;

interface CalendarSnapshot {
  appointments: RouteAppointment[];
  rowData: AttendanceRowData;
  /** 予定の内容の指紋(勤怠集計のミラーの重複排除)。 */
  fingerprint: string;
}

async function fetchCalendar(
  deps: CalendarSyncDeps,
  actor: { tenantId: string; staffId: string | null },
  target: { staffId: string },
  date: string,
): Promise<CalendarSnapshot> {
  const result = await getFreshScheduleWithRouteForStaff(deps, {
    tenantId: actor.tenantId,
    actorStaffId: actor.staffId,
    targetStaffId: target.staffId,
    date,
  });
  if (!result.success) {
    const reason = result.message ? `(${result.message})` : '';
    throw new DomainError('upstream_unavailable', `カレンダー予定の取得に失敗しました。${reason}`);
  }
  const appointments = mergeOverlappingOfficeAppointments(result.appointments ?? []) as RouteAppointment[];
  return {
    appointments,
    rowData: buildRowDataFromAppointments(appointments),
    fingerprint: createHash('sha256').update(JSON.stringify(appointments)).digest('hex').slice(0, 16),
  };
}

interface ComputedSync {
  next: AttendanceSheetDay;
  changes: CellChange[];
  appointmentCount: number;
}

/** 予定の顧客ID(RESERVA の顧客ID)→ 顧客。 */
async function resolveCustomers(
  r: TenantRepositories,
  appointments: RouteAppointment[],
): Promise<Map<string, string>> {
  const ids = [...new Set(appointments.map((a) => a.customerId).filter(Boolean))];
  const map = new Map<string, string>();
  for (const externalId of ids) {
    const record = await r.customerSourceRecords.findByExternalId('reserva', externalId);
    if (record) map.set(externalId, record.customerId);
  }
  return map;
}

function toMinutesOrNull(time: string): number | null {
  return parseTimeToMinutes(String(time).slice(0, 5));
}

/**
 * 出勤簿の現在の内容とカレンダーを突き合わせて次の状態を作る(書き込まない)。
 * 枠に載る訪問には予定の顧客を結び付け、4件目以降の訪問はカレンダー由来の訪問として揃える。
 */
async function computeSync(
  r: TenantRepositories,
  current: AttendanceSheetDay,
  calendar: CalendarSnapshot,
): Promise<ComputedSync> {
  const currentRow = projectDay(current).rowData;
  const plan = buildCalendarSyncPlan(currentRow, canonicalizeRowData(calendar.rowData));
  const { next } = applyRowEdit(current, plan.valuesToApply, { source: 'calendar_sync', newId });
  const visitAppointments = visitAppointmentsInSlotOrder(calendar.appointments);
  const customers = await resolveCustomers(r, visitAppointments);

  visitAppointments.slice(0, SHEET_VISIT_SLOT_COUNT).forEach((appointment, i) => {
    const visit = next.visits.find((v) => v.seq === i + 1);
    if (visit) visit.customerId = customers.get(appointment.customerId) ?? null;
  });
  const extras = visitAppointments.slice(SHEET_VISIT_SLOT_COUNT);
  next.visits = next.visits.filter(
    (v) => v.seq <= SHEET_VISIT_SLOT_COUNT + extras.length || v.source !== 'google_calendar',
  );
  extras.forEach((appointment, i) => {
    const seq = SHEET_VISIT_SLOT_COUNT + 1 + i;
    const start = toMinutesOrNull(appointment.startTime);
    let end = toMinutesOrNull(appointment.endTime);
    if (start !== null && end !== null && end < start) end += 1440;
    const fields = {
      label: appointment.customerName,
      start,
      end,
      plannedStart: start,
      plannedEnd: end,
      customerId: customers.get(appointment.customerId) ?? null,
    };
    const existing = next.visits.find((v) => v.seq === seq);
    if (existing) Object.assign(existing, fields, { source: 'google_calendar' as const });
    else {
      next.visits.push({
        id: newId(),
        seq,
        ...fields,
        status: 'completed',
        source: 'google_calendar',
        externalEventId: null,
        overriddenFields: [],
      });
    }
  });
  return { next, changes: plan.changes, appointmentCount: calendar.appointments.length };
}

export interface CalendarSyncResult {
  staffId: string;
  staffName: string;
  date: string;
  appointmentCount: number;
  changes: CellChange[];
}

/**
 * 1スタッフ・1日分をカレンダーから反映する(権限を確かめた後の共通処理。API と夜間バッチから使う)。
 * 冪等: 同じカレンダーの内容なら2回目以降は changes が空で、出勤簿もミラーも書かない。勤怠集計のミラーは
 * 予定の内容が変わったときに積む(GAS側が行を計算し直す)。予定が無く出勤簿の行も無い日は何も書かない。
 * 予定の取得はトランザクションの外、出勤簿の読み→書きはその日の行を押さえた1トランザクション(手入力と重ならない)。
 */
export async function syncStaffDayFromCalendar(
  deps: CalendarSyncDeps,
  actor: { tenantId: string; staffId: string | null },
  target: { staffId: string; staffName: string },
  date: string,
): Promise<CalendarSyncResult> {
  const calendar = await fetchCalendar(deps, actor, target, date);
  const changes = await deps.uow.run(
    actor.tenantId,
    async (r) => {
      // 予定が無く、その日の出勤簿の行もまだ無ければ何も作らない(空の行・勤怠集計のミラーを積まない)。
      // 行があれば(予定が消えた等)いつも通り反映し、勤怠集計の行も書き直す(GAS版は行を消す)
      if (calendar.appointments.length === 0 && !(await r.attendance.loadDay(target.staffId, date)).day) {
        return [];
      }
      const timeZone = (await r.tenant()).timezone;
      const rows = await r.attendance.lockDay(target.staffId, date, newId());
      const current = toSheetDay(timeZone, rows);
      const computed = await computeSync(r, current, calendar);
      const saved = await writeSheetDiff(
        r,
        { timeZone, changedBy: actor.staffId, changeSource: 'calendar_sync' },
        rows,
        current,
        computed.next,
      );
      if (saved) await enqueueAttendanceDayMirror(r, saved, changedSheetColumns(current, computed.next));
      await enqueueAttendanceAggregateMirror(r, rows.day.id, calendar.fingerprint);
      return computed.changes;
    },
    { actorId: actor.staffId },
  );
  return {
    staffId: target.staffId,
    staffName: target.staffName,
    date,
    appointmentCount: calendar.appointments.length,
    changes,
  };
}

async function loadTarget(
  deps: CalendarSyncDeps,
  actor: Actor,
  targetStaffId: string,
): Promise<AttendanceTarget> {
  return deps.uow.run(actor.tenantId, (r) => loadAttendanceTarget(r, actor, targetStaffId));
}

async function logSyncFailure(
  deps: CalendarSyncDeps,
  actor: Actor,
  target: AttendanceTarget | null,
  action: string,
  date: string,
  error: unknown,
): Promise<void> {
  await writeActorLog(deps.appLog, actor, target, {
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
  changes: CellChange[];
}

/** 「カレンダーから反映」の確認用: 何も書き込まず、反映した場合に変わるセルだけを返す。 */
export async function previewCalendarSync(
  deps: CalendarSyncDeps,
  actor: Actor,
  targetStaffId: string,
  date: string,
): Promise<CalendarSyncPreview> {
  const target = await loadTarget(deps, actor, targetStaffId);
  try {
    const calendar = await fetchCalendar(deps, actor, target, date);
    const computed = await deps.uow.run(actor.tenantId, async (r) => {
      const timeZone = (await r.tenant()).timezone;
      const rows = await r.attendance.loadDay(target.staffId, date);
      return computeSync(r, toSheetDay(timeZone, rows), calendar);
    });
    // 予定の取得(Maps の計算を伴う)はコストがあるため、他スタッフ分の操作は記録する
    await logCrossStaffRead(deps.appLog, actor, target, 'attendance.calendar_sync.preview', {
      date,
      appointmentCount: computed.appointmentCount,
      changedCount: computed.changes.length,
    });
    return {
      staffId: target.staffId,
      staffName: target.staffName,
      date,
      appointmentCount: computed.appointmentCount,
      hasChanges: computed.changes.length > 0,
      changes: computed.changes,
    };
  } catch (error) {
    await logSyncFailure(deps, actor, target, 'attendance.calendar_sync.preview_failed', date, error);
    throw error;
  }
}

/**
 * プレビュー確認後の反映。クライアントが見た差分は信用せず、書き込みの時に同じ計算をやり直す。
 */
export async function applyCalendarSync(
  deps: CalendarSyncDeps,
  actor: Actor,
  targetStaffId: string,
  date: string,
): Promise<CalendarSyncResult> {
  const target = await loadTarget(deps, actor, targetStaffId);
  try {
    const result = await syncStaffDayFromCalendar(deps, actor, target, date);
    await writeActorLog(deps.appLog, actor, target, {
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
 * 管理者専用: 「勤怠集計」シートの該当スタッフ・該当日の行をカレンダーから書き直す(GAS版
 * refreshAttendanceForStaffOnDate)。個別の出勤簿は書き換えない。明示の操作のため毎回積む。
 */
export async function refreshAttendanceAggregate(
  deps: CalendarSyncDeps,
  actor: Actor,
  targetStaffId: string,
  date: string,
): Promise<AttendanceAggregateRefreshResult> {
  if (!isAdminRole(actor.role)) {
    await writeActorLog(deps.appLog, actor, null, {
      level: 'WARN',
      action: 'attendance.aggregate.refresh_denied',
      details: { date, requestedStaffId: targetStaffId },
    });
    throw forbidden('この操作には管理者権限が必要です。');
  }
  const target = await loadTarget(deps, actor, targetStaffId);
  try {
    const calendar = await fetchCalendar(deps, actor, target, date);
    await deps.uow.run(actor.tenantId, async (r) => {
      const rows = await r.attendance.lockDay(target.staffId, date, newId());
      await enqueueAttendanceAggregateMirror(r, rows.day.id, calendar.fingerprint, { force: true });
    });
    await writeActorLog(deps.appLog, actor, target, {
      level: 'INFO',
      action: 'attendance.aggregate.refresh',
      details: { date, appointmentCount: calendar.appointments.length },
    });
    return {
      staffId: target.staffId,
      staffName: target.staffName,
      date,
      appointmentCount: calendar.appointments.length,
      rowData: compactRowData(canonicalizeRowData(calendar.rowData)),
    };
  } catch (error) {
    await logSyncFailure(deps, actor, target, 'attendance.aggregate.refresh_failed', date, error);
    throw error;
  }
}
