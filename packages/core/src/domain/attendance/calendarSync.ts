import { parseTimeToMinutes } from './attendanceCalc';
import { type AttendanceCellChange, cellChange, cellValue } from './rowDiff';
import {
  ATTENDANCE_SLOTS,
  type AttendanceColumnKey,
  type AttendanceTimeSlot,
  COMMUTE_DISTANCE_COLUMN,
  LEAVING_DISTANCE_COLUMN,
  MOVE_LEGS,
  OFFICE_SLOTS,
  VISIT_SLOTS,
} from './sheetLayout';
import type { AttendanceRowData } from './types';

/**
 * カレンダー予定 → 出勤簿1日分の変換と、既存の出勤簿との非破壊マージ。
 *
 * 移植元: gas-childcare-visit-app/RouteSearch.js の mergeOverlappingOfficeWork /
 * isOfficeWorkAppointment / calcDurationMinForAttendance / buildTimesheetRowDataFromAppointments_、
 * PastSchedule.js の timeRangesOverlap_ / buildCalendarSyncPlan_ / PAST_SCHEDULE_SYNC_SLOTS。
 * 挙動(どの予定がどの枠に入るか、何を上書きし何を残すか)はGAS版と同一で、
 * calendarSync.test.ts でGAS版のコードそのものと出力を突き合わせている。
 */

export const OFFICE_WORK_EVENT_TYPE = 'OFFICE WORK';
const CUSTOMER_APPOINTMENT_EVENT_TYPE = 'CUSTOMER APPOINTMENT';
/** 15分ちょうどの顧客予定は事務作業(電話対応等)として扱う(GAS版の運用ルール)。 */
const OFFICE_WORK_DURATION_MIN = 15;

/** カレンダー予定1件(SchedulePort の「ルート・移動時間つき」予定のうち、出勤簿に使う項目)。 */
export interface CalendarAppointment {
  eventType: string;
  customerName: string;
  /** 'HH:mm' */
  startTime: string;
  /** 'HH:mm' */
  endTime: string;
  /** 直前の(位置情報のある)予定からの移動時間(分)・距離(km)。 */
  moveMin?: number | string;
  moveKm?: number | string;
  /** 自宅→この予定の距離(位置情報のある最初の予定だけが持つ)。 */
  attendanceKm?: number | string;
  /** この予定→自宅の距離(位置情報のある最後の予定だけが持つ)。 */
  leavingKm?: number | string;
}

function minutesOf(time: string): number {
  return parseTimeToMinutes(String(time).substring(0, 5)) ?? 0;
}

/** 予定の所要時間(分)。終了が開始より前なら日付をまたいだとみなす。時刻が読めなければnull。 */
export function appointmentDurationMinutes(startTime: string, endTime: string): number | null {
  if (!startTime || !endTime) return null;
  const start = parseTimeToMinutes(String(startTime).substring(0, 5));
  const end = parseTimeToMinutes(String(endTime).substring(0, 5));
  if (start === null || end === null) return null;
  return end >= start ? end - start : 24 * 60 - start + end;
}

export function isOfficeWorkAppointment(appointment: CalendarAppointment): boolean {
  if (appointment.eventType === OFFICE_WORK_EVENT_TYPE) return true;
  if (appointment.eventType === CUSTOMER_APPOINTMENT_EVENT_TYPE) {
    return (
      appointmentDurationMinutes(appointment.startTime, appointment.endTime) === OFFICE_WORK_DURATION_MIN
    );
  }
  return false;
}

/**
 * 時間の重なる事務作業を1件にまとめる(内容は「,」区切りで連結、終了は遅い方)。
 * 結果は開始時刻順に並べ直す(GAS版はこの後スタッフごとに開始時刻で並べていた)。
 *
 * 予定の取得側(domain/schedule の mergeOverlappingOfficeWork)でもカレンダーの予定の段階で同じまとめを
 * 行っている。こちらは1スタッフ分の 'HH:mm' の予定に対する版で、どの SchedulePort 実装から来た予定でも
 * 出勤簿の枠の割り当てが同じになるよう、出勤簿へ変換する直前に必ず通す(まとめ済みなら結果は変わらない)。
 */
export function mergeOverlappingOfficeAppointments<T extends CalendarAppointment>(
  appointments: readonly T[],
): T[] {
  const officeWorks = appointments.filter((a) => a.eventType === OFFICE_WORK_EVENT_TYPE);
  if (officeWorks.length === 0) return [...appointments];
  const others = appointments.filter((a) => a.eventType !== OFFICE_WORK_EVENT_TYPE);

  const sorted = [...officeWorks].sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
  const merged: T[] = [];
  let group: { base: T; names: string[]; start: string; end: string } | null = null;
  for (const work of sorted) {
    if (group && minutesOf(work.startTime) < minutesOf(group.end)) {
      group.names.push(work.customerName);
      if (minutesOf(work.endTime) > minutesOf(group.end)) group.end = work.endTime;
      continue;
    }
    if (group) merged.push(toMerged(group));
    group = { base: work, names: [work.customerName], start: work.startTime, end: work.endTime };
  }
  if (group) merged.push(toMerged(group));

  return [...others, ...merged].sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));
}

function toMerged<T extends CalendarAppointment>(group: {
  base: T;
  names: string[];
  start: string;
  end: string;
}): T {
  return { ...group.base, customerName: group.names.join(','), startTime: group.start, endTime: group.end };
}

/** 数値0を未入力扱いしないための変換(GAS版 emptyOrValue_)。 */
function toCellValue(value: number | string | undefined | null): string {
  return value === undefined || value === null || value === '' ? '' : String(value);
}

const hasValue = (value: number | string | undefined | null): boolean => toCellValue(value) !== '';

function writeSlot(row: AttendanceRowData, slot: AttendanceTimeSlot, appointment: CalendarAppointment): void {
  row[slot.title] = appointment.customerName || '';
  row[slot.start] = appointment.startTime || '';
  row[slot.end] = appointment.endTime || '';
}

/** カレンダー反映で書き換え対象になる列(天候・買物代行・備考は含まない)。 */
const CALENDAR_COLUMNS: readonly AttendanceColumnKey[] = [
  ...new Set([...ATTENDANCE_SLOTS.flatMap((slot) => slot.syncColumns), LEAVING_DISTANCE_COLUMN]),
];

/**
 * その日のカレンダー予定から出勤簿1日分を組み立てる。
 * 訪問は先頭から#1〜#3、事務作業(15分の顧客予定を含む)は#1〜#2に入り、それ以上は捨てる。
 * #2/#3には直前からの移動時間・距離を入れる。出勤距離・退勤距離は、それを持つ予定
 * (位置情報のある最初/最後の予定。オンライン予定等があると先頭/末尾とは限らない)から取る。
 */
export function buildRowDataFromAppointments(
  appointments: readonly CalendarAppointment[],
): AttendanceRowData {
  const row: AttendanceRowData = Object.fromEntries(CALENDAR_COLUMNS.map((column) => [column, '']));
  const merged = mergeOverlappingOfficeAppointments(appointments);
  const officeWorks = merged.filter(isOfficeWorkAppointment);
  const visits = merged.filter((a) => !isOfficeWorkAppointment(a));

  VISIT_SLOTS.forEach((slot, i) => {
    const visit = visits[i];
    if (visit) writeSlot(row, slot, visit);
  });
  MOVE_LEGS.forEach((leg, i) => {
    const arriving = visits[i + 1];
    if (!arriving) return;
    row[leg.plannedMinutes] = toCellValue(arriving.moveMin);
    row[leg.distanceKm] = toCellValue(arriving.moveKm);
  });

  const withCommute = visits.find((v) => hasValue(v.attendanceKm));
  if (withCommute) row[COMMUTE_DISTANCE_COLUMN] = toCellValue(withCommute.attendanceKm);
  const withLeaving = visits.find((v) => hasValue(v.leavingKm));
  if (withLeaving) row[LEAVING_DISTANCE_COLUMN] = toCellValue(withLeaving.leavingKm);

  OFFICE_SLOTS.forEach((slot, i) => {
    const work = officeWorks[i];
    if (work) writeSlot(row, slot, work);
  });

  return row;
}

/** 'HH:mm' の時間帯同士が重なるか(端点が接するだけなら重ならない)。 */
export function timeRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const sA = parseTimeToMinutes(startA);
  const eA = parseTimeToMinutes(endA);
  const sB = parseTimeToMinutes(startB);
  const eB = parseTimeToMinutes(endB);
  if (sA === null || eA === null || sB === null || eB === null) return false;
  return sA < eB && sB < eA;
}

const isSlotFilled = (row: AttendanceRowData, slot: AttendanceTimeSlot): boolean =>
  Boolean(row[slot.start] && row[slot.end]);

export interface CalendarSyncPlan {
  /** 実際に値が変わる列(プレビュー表示・変更履歴用)。 */
  changes: AttendanceCellChange[];
  /** 書き込む列と値(値が同じ列も含む)。ここに無い列は出勤簿の値をそのまま残す。 */
  valuesToApply: AttendanceRowData;
}

/**
 * 出勤簿の現在の内容とカレンダー由来の内容を突き合わせ、書き込む列を決める。
 *
 * 手入力で追加した(カレンダーに無い)予定を自動で消さないための方針:
 * - カレンダー側に予定がある時間帯(開始・終了とも入力あり)は、カレンダーの内容で上書きする。
 * - カレンダー側に無く出勤簿側にだけある時間帯は、カレンダー由来の他の時間帯と時間が重なる場合に限り
 *   (=カレンダー側で別の枠に表現し直されたとみなして)クリアし、重ならなければ一切触らない。
 * - 退勤距離は、カレンダー由来の訪問のうち最後に埋まっている枠に付随するため別に1回だけ判定する。
 */
export function buildCalendarSyncPlan(
  current: AttendanceRowData,
  incoming: AttendanceRowData,
): CalendarSyncPlan {
  const changes: AttendanceCellChange[] = [];
  const valuesToApply: AttendanceRowData = {};
  const write = (column: AttendanceColumnKey, newValue: string): void => {
    const oldValue = cellValue(current, column);
    if (oldValue !== newValue) changes.push(cellChange(column, oldValue, newValue));
    valuesToApply[column] = newValue;
  };

  const incomingFilledSlots = ATTENDANCE_SLOTS.filter((slot) => isSlotFilled(incoming, slot));

  for (const slot of ATTENDANCE_SLOTS) {
    if (isSlotFilled(incoming, slot)) {
      for (const column of slot.syncColumns) write(column, cellValue(incoming, column));
      continue;
    }
    if (!isSlotFilled(current, slot)) continue;

    const overlapsIncoming = incomingFilledSlots.some((other) =>
      timeRangesOverlap(
        cellValue(current, slot.start),
        cellValue(current, slot.end),
        cellValue(incoming, other.start),
        cellValue(incoming, other.end),
      ),
    );
    if (overlapsIncoming) {
      for (const column of slot.syncColumns) write(column, '');
    }
  }

  const lastIncomingVisit = incomingFilledSlots.filter((slot) => slot.kind === 'visit').pop();
  if (lastIncomingVisit) {
    write(LEAVING_DISTANCE_COLUMN, cellValue(incoming, LEAVING_DISTANCE_COLUMN));
  }

  return { changes, valuesToApply };
}
