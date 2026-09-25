import { describe, expect, it } from 'vitest';
import { GAS_LEGACY_AVAILABLE, type GasFunctions, loadGasDeclarations } from '../../testSupport/gasLegacy';
import { computeDayDerived, computeMonthlyTotals } from './attendanceCalc';
import {
  buildCalendarSyncPlan,
  buildRowDataFromAppointments,
  type CalendarAppointment,
  mergeOverlappingOfficeAppointments,
} from './calendarSync';
import { buildScheduleEventsFromRowData } from './scheduleEvents';
import { ATTENDANCE_COLUMN_KEYS, type AttendanceColumnKey } from './sheetLayout';
import type { AttendanceRowData } from './types';

/**
 * GAS版のコードそのもの(legacy サブモジュール)とTypeScript実装に、乱数で作った同じ入力を
 * 大量に与えて出力が完全一致することを確かめる回帰テスト。
 * 乱数は固定シードなので、失敗したケースは毎回同じように再現する。
 */

function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  const chance = (p: number): boolean => next() < p;
  return { int, pick, chance };
}
type Random = ReturnType<typeof createRandom>;

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** 時刻は15分刻み(境界・重なり・接触が頻繁に起きるように)。 */
function randomTime(r: Random): string {
  return hhmm(r.int(28, 88) * 15);
}

function randomCell(r: Random, column: AttendanceColumnKey): string {
  if (r.chance(0.35)) return '';
  if (['D', 'E', 'M', 'N', 'V', 'W', 'Y', 'Z', 'AB', 'AC'].includes(column)) {
    return r.chance(0.05) ? '9時' : randomTime(r);
  }
  if (['H', 'Q', 'AG', 'AH', 'AI', 'AJ', 'AN'].includes(column)) {
    return r.pick(['0', '5', '12.5', '15', '16', '20.25', '31', 'abc']);
  }
  if (column === 'I' || column === 'R') return r.pick(['晴れ', '雨', '雪', '曇り']);
  if (column === 'X' || column === 'AA') return r.pick(['チームmtg', '広報業務', 'MTG', '事務']);
  return r.pick(['佐藤様', '鈴木様', '田中様', '']);
}

function randomRowData(r: Random): AttendanceRowData {
  const row: AttendanceRowData = {};
  for (const column of ATTENDANCE_COLUMN_KEYS) {
    if (r.chance(0.8)) row[column] = randomCell(r, column);
  }
  return row;
}

function randomAppointments(r: Random): CalendarAppointment[] {
  const count = r.int(0, 7);
  const appointments: CalendarAppointment[] = [];
  let cursor = r.int(28, 60) * 15;
  for (let i = 0; i < count; i++) {
    const start = Math.min(cursor + r.pick([0, 0, 15, 30]), 22 * 60);
    const duration = r.pick([15, 30, 60, 90, 120]);
    const km = (): number | string => (r.chance(0.3) ? '' : r.pick([0, 3.2, 12, 18.75]));
    appointments.push({
      eventType: r.pick(['CUSTOMER APPOINTMENT', 'CUSTOMER APPOINTMENT', 'OFFICE WORK', 'EVENT']),
      customerName: r.pick(['佐藤様', '鈴木様', '田中様', '研修']),
      startTime: hhmm(start),
      endTime: hhmm(Math.min(start + duration, 23 * 60 + 45)),
      moveMin: r.chance(0.3) ? '' : r.pick([0, 10, 25]),
      moveKm: km(),
      attendanceKm: km(),
      leavingKm: km(),
    });
    // 次の予定は重なることも離れることもある
    cursor = start + r.pick([0, 15, duration, duration + 30]);
  }
  return appointments;
}

/** GAS版の出力(別realmのオブジェクト・数値セル)を、比較できる素のJSONにする。 */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const stringifyValues = (row: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, String(v)]));

describe.skipIf(!GAS_LEGACY_AVAILABLE)('GAS版コードとの出力一致', () => {
  const load = (): GasFunctions =>
    loadGasDeclarations({
      'AttendanceCalc.js': [
        'CORE_START_MIN',
        'CORE_END_MIN',
        'OVER_THRESHOLD_KM',
        'OVER_THRESHOLD_STEP_KM',
        'SNOW_MOVE_MULTIPLIER',
        'parseTimeToMinutes',
        'formatMinutesToTime',
        'toNumberOrNull',
        'computeMoveChain',
        'splitCoreAndOvertimeMinutes',
        'isMtgLabel',
        'computeLaborAndOvertime',
        'countOverThreshold',
        'computeVisitCount',
        'computeDistanceAggregates',
        'computeDayDerived',
        'computeMonthlyTotals',
      ],
      'PastSchedule.js': [
        'PAST_SCHEDULE_INPUT_COLUMNS',
        'PAST_SCHEDULE_SYNC_SLOTS',
        'PAST_SCHEDULE_VISIT_SLOT_KEYS',
        'isSamePastScheduleValue_',
        'timeRangesOverlap_',
        'buildCalendarSyncPlan_',
        'buildScheduleEventsFromRowData_',
      ],
      'RouteSearch.js': [
        'normalizeStaffName_',
        'mergeOverlappingOfficeWork',
        'calcDurationMinForAttendance',
        'isOfficeWorkAppointment',
        'emptyOrValue_',
        'buildTimesheetRowDataFromAppointments_',
      ],
    });
  // skipIf でスキップされても describe の中身は収集のために実行されるため、GAS版のソースは
  // 最初に使うときに読む(サブモジュールが無い環境でファイルの読み込みエラーにしない)
  let gas: GasFunctions | undefined;
  const gasFn = (name: string) => {
    gas ??= load();
    const fn = gas[name];
    if (!fn) throw new Error(`GAS版の関数がありません: ${name}`);
    return fn;
  };
  const CASES = 1500;

  it('computeDayDerived / computeMonthlyTotals(AttendanceCalc.js)', () => {
    const r = createRandom(20260925);
    const days = [];
    for (let i = 0; i < CASES; i++) {
      const rowData = randomRowData(r);
      const derived = computeDayDerived(rowData);
      expect(derived, JSON.stringify(rowData)).toEqual(plain(gasFn('computeDayDerived')(rowData)));
      days.push({ rowData, derived });
    }
    for (let start = 0; start < days.length; start += 31) {
      const month = days.slice(start, start + 31);
      expect(computeMonthlyTotals(month)).toEqual(plain(gasFn('computeMonthlyTotals')(month)));
    }
  });

  it('buildCalendarSyncPlan(PastSchedule.js buildCalendarSyncPlan_)', () => {
    const r = createRandom(1);
    for (let i = 0; i < CASES; i++) {
      const current = randomRowData(r);
      const incoming = buildRowDataFromAppointments(randomAppointments(r));
      const ours = buildCalendarSyncPlan(current, incoming);
      const theirs = plain(gasFn('buildCalendarSyncPlan_')(current, incoming));
      const context = JSON.stringify({ current, incoming });
      expect(
        ours.changes.map((c) => ({
          col: c.column,
          label: c.label,
          oldValue: c.oldValue,
          newValue: c.newValue,
        })),
        context,
      ).toEqual(theirs.changes);
      expect(ours.valuesToApply, context).toEqual(theirs.valuesToApply);
    }
  });

  it('buildRowDataFromAppointments(RouteSearch.js buildTimesheetRowDataFromAppointments_)', () => {
    const r = createRandom(2);
    for (let i = 0; i < CASES; i++) {
      // GAS版は事務作業のまとめ(mergeOverlappingOfficeWork)をカレンダー取得時に済ませているため、
      // まとめ済みの予定をGAS版に渡して比較する。
      const appointments = mergeOverlappingOfficeAppointments(randomAppointments(r));
      const gasInput = appointments.map((a) => ({ ...a }));
      expect(buildRowDataFromAppointments(appointments), JSON.stringify(appointments)).toEqual(
        stringifyValues(plain(gasFn('buildTimesheetRowDataFromAppointments_')(gasInput))),
      );
    }
  });

  it('mergeOverlappingOfficeAppointments(RouteSearch.js mergeOverlappingOfficeWork+開始時刻順の並べ替え)', () => {
    const r = createRandom(3);
    const day = (time: string): Date => new Date(`2026-09-25T${time}:00+09:00`);
    const jst = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tokyo',
      hour: '2-digit',
      minute: '2-digit',
    });
    const toHhmm = (d: Date): string => jst.format(d);
    for (let i = 0; i < CASES; i++) {
      const appointments = randomAppointments(r);
      const gasEvents = appointments.map((a) => ({
        startTime: day(a.startTime),
        endTime: day(a.endTime),
        eventType: a.eventType,
        customerInfo: { name: a.customerName, address: '', lat: '', lng: '', parkingarea: '' },
        staffNameRaw: '佐藤 花子',
      }));
      const merged = (gasFn('mergeOverlappingOfficeWork')(gasEvents) as typeof gasEvents)
        .slice()
        .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
      expect(
        mergeOverlappingOfficeAppointments(appointments).map((a) => [
          a.eventType,
          a.customerName,
          a.startTime,
          a.endTime,
        ]),
        JSON.stringify(appointments),
      ).toEqual(
        merged.map((e) => [e.eventType, e.customerInfo.name, toHhmm(e.startTime), toHhmm(e.endTime)]),
      );
    }
  });

  it('buildScheduleEventsFromRowData(PastSchedule.js buildScheduleEventsFromRowData_)', () => {
    const r = createRandom(4);
    for (let i = 0; i < CASES; i++) {
      const rowData = randomRowData(r);
      expect(buildScheduleEventsFromRowData('2026-09-25', rowData)).toEqual(
        plain(gasFn('buildScheduleEventsFromRowData_')('2026-09-25', rowData)),
      );
    }
  });
});
