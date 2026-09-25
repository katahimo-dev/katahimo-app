import {
  ATTENDANCE_SLOTS,
  COMMUTE_DISTANCE_COLUMN,
  LEAVING_DISTANCE_COLUMN,
  MOVE_LEGS,
  type MoveLeg,
  SHOPPING_ERRAND_COLUMN,
  SNOW_WEATHER,
} from './sheetLayout';
import type {
  AttendanceDayDerived,
  AttendanceMonthlyDay,
  AttendanceMonthlyTotals,
  AttendanceRowData,
  CoreAndOvertime,
  DistanceAggregates,
  LaborAndOvertime,
  MoveChainResult,
} from './types';

/**
 * 出勤簿テンプレート(出勤簿テンプレート.xlsx)の数式列を再現した純粋計算関数群。
 *
 * 移植元: gas-childcare-visit-app/AttendanceCalc.js。計算式は一切変えていない
 * (列の参照を sheetLayout.ts の名前付き定義経由にしただけ)。給与計算に直結するため、
 * 変更時は attendanceCalc.test.ts(GAS版の実行結果を正解とした回帰テスト)が通ることを必ず確認する。
 */

const CORE_START_MIN = 10 * 60; // 10:00
const CORE_END_MIN = 17 * 60; // 17:00
const OVER_THRESHOLD_KM = 15;
const OVER_THRESHOLD_STEP_KM = 5;
const SNOW_MOVE_MULTIPLIER = 1.3;

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function parseTimeToMinutes(hhmm: string | undefined | null): number | null {
  if (!hhmm || typeof hhmm !== 'string') return null;
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mi)) return null;
  return h * 60 + mi;
}

export function formatMinutesToTime(totalMinutes: number | null | undefined): string {
  if (totalMinutes === null || totalMinutes === undefined || Number.isNaN(totalMinutes)) return '';
  const clamped = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(clamped / 60) % 24;
  const mi = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function toNumberOrNull(v: string | undefined | null): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const numberOrZero = (v: string | undefined): number => toNumberOrNull(v) || 0;
const blankToZero = (v: number | ''): number => (v === '' ? 0 : v);

/**
 * F/G/J/K(またはO/P/S/T)相当。ある訪問の終業時刻・次の移動の計画時間・気象状況・
 * 次の訪問の始業時刻から、移動開始/移動終了/天候補正後移動時間/待機時間を計算する。
 */
export function computeMoveChain(
  prevEndTime: string | undefined,
  plannedMoveMin: string | undefined,
  weather: string | undefined,
  nextStartTime: string | undefined,
): MoveChainResult {
  const moveStartMin = parseTimeToMinutes(prevEndTime);
  const planned = toNumberOrNull(plannedMoveMin);
  const nextStartMin = parseTimeToMinutes(nextStartTime);

  const weatherAdjustedMoveMin =
    planned === null ? null : weather === SNOW_WEATHER ? planned * SNOW_MOVE_MULTIPLIER : planned;
  const moveEndMin = moveStartMin !== null && planned !== null ? moveStartMin + planned : null;
  const waitMin =
    moveEndMin !== null && nextStartMin !== null ? Math.max(0, nextStartMin - moveEndMin) : null;

  return {
    moveStart: moveStartMin === null ? '' : formatMinutesToTime(moveStartMin),
    moveEnd: moveEndMin === null ? '' : formatMinutesToTime(moveEndMin),
    weatherAdjustedMoveMin: weatherAdjustedMoveMin === null ? '' : round2(weatherAdjustedMoveMin),
    waitMin: waitMin === null ? '' : Math.round(waitMin),
  };
}

function computeLegMoveChain(rowData: AttendanceRowData, leg: MoveLeg): MoveChainResult {
  return computeMoveChain(
    rowData[leg.from.end],
    rowData[leg.plannedMinutes],
    rowData[leg.weather],
    rowData[leg.to.start],
  );
}

/**
 * ある1つの時間帯(開始・終了)を所定内(10:00-17:00)/所定外に振り分ける。
 * mtg特例が真の場合、時間帯全体を所定内として扱う(所定外は常に0)。
 */
export function splitCoreAndOvertimeMinutes(
  startTime: string | undefined,
  endTime: string | undefined,
  isMtgException: boolean,
): CoreAndOvertime {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return { core: 0, overtime: 0 };
  }
  const total = endMin - startMin;
  if (isMtgException) {
    return { core: total, overtime: 0 };
  }
  const core = Math.max(0, Math.min(endMin, CORE_END_MIN) - Math.max(startMin, CORE_START_MIN));
  return { core, overtime: total - core };
}

export function isMtgLabel(label: string | undefined): boolean {
  return typeof label === 'string' && /mtg/i.test(label);
}

/**
 * AD(労働時間数)/AE(残業時間)相当。訪問3件+事務作業2件、計5つの時間帯を集計する。
 * 事務作業の内容に「mtg」を含む時間帯は全体を所定内として扱う。
 *
 * workedMinutes(所定内+所定外)は画面の「働いた時間」用。AD列は所定内しか数えないため、
 * 17時以降の訪問だけの日に0分と表示されてしまう問題(GAS版 2026-09-17)への対応でGAS版に追加された値。
 */
export function computeLaborAndOvertime(rowData: AttendanceRowData): LaborAndOvertime {
  let laborMinutes = 0;
  let overtimeMinutes = 0;
  for (const slot of ATTENDANCE_SLOTS) {
    const isMtg = slot.kind === 'office' && isMtgLabel(rowData[slot.title]);
    const { core, overtime } = splitCoreAndOvertimeMinutes(rowData[slot.start], rowData[slot.end], isMtg);
    laborMinutes += core;
    overtimeMinutes += overtime;
  }

  return {
    laborMinutes: Math.round(laborMinutes),
    overtimeMinutes: round2(overtimeMinutes),
    workedMinutes: Math.round(laborMinutes + overtimeMinutes),
  };
}

/**
 * AL(基準距離超過回数)相当: 各距離が15kmを超えた分を5km刻みでカウントし合計する。
 */
export function countOverThreshold(distances: Array<string | undefined>): number {
  return distances.reduce((sum: number, d) => {
    const n = toNumberOrNull(d);
    if (n === null) return sum;
    return sum + Math.floor(Math.max(0, n - OVER_THRESHOLD_KM) / OVER_THRESHOLD_STEP_KM);
  }, 0);
}

/**
 * AM(訪問等回数)相当: #2→#3移動距離が数値なら3、#1→#2移動距離が数値なら2、
 * 出勤/退勤距離のどちらかが数値なら1、それ以外は0。
 */
export function computeVisitCount(rowData: AttendanceRowData): number {
  const [leg1, leg2] = MOVE_LEGS;
  if (toNumberOrNull(rowData[leg2.distanceKm]) !== null) return 3;
  if (toNumberOrNull(rowData[leg1.distanceKm]) !== null) return 2;
  if (
    toNumberOrNull(rowData[COMMUTE_DISTANCE_COLUMN]) !== null ||
    toNumberOrNull(rowData[LEAVING_DISTANCE_COLUMN]) !== null
  ) {
    return 1;
  }
  return 0;
}

/** 1日の距離の列(#1→#2、#2→#3、出勤、退勤)の値。 */
function distanceValues(rowData: AttendanceRowData): Array<string | undefined> {
  return [
    ...MOVE_LEGS.map((leg) => rowData[leg.distanceKm]),
    rowData[COMMUTE_DISTANCE_COLUMN],
    rowData[LEAVING_DISTANCE_COLUMN],
  ];
}

/**
 * AF/AK/AL/AM相当。移動時間は天候補正後の値(J/S)を使う。
 */
export function computeDistanceAggregates(
  rowData: AttendanceRowData,
  leg1WeatherAdjustedMoveMin: number | '',
  leg2WeatherAdjustedMoveMin: number | '',
): DistanceAggregates {
  const distances = distanceValues(rowData);
  const totalDistance = distances.reduce((sum: number, d) => sum + numberOrZero(d), 0);

  return {
    totalMoveMin: round2(blankToZero(leg1WeatherAdjustedMoveMin) + blankToZero(leg2WeatherAdjustedMoveMin)),
    totalDistanceKm: round2(totalDistance),
    overThresholdCount: countOverThreshold(distances),
    visitCount: computeVisitCount(rowData),
  };
}

/**
 * 1日分のrowDataから、テンプレートの数式列に相当する派生値をすべて計算する。
 */
export function computeDayDerived(rowData: AttendanceRowData | undefined | null): AttendanceDayDerived {
  const data = rowData ?? {};
  const [leg1Def, leg2Def] = MOVE_LEGS;
  const leg1 = computeLegMoveChain(data, leg1Def);
  const leg2 = computeLegMoveChain(data, leg2Def);
  const labor = computeLaborAndOvertime(data);
  const distanceAgg = computeDistanceAggregates(
    data,
    leg1.weatherAdjustedMoveMin,
    leg2.weatherAdjustedMoveMin,
  );

  return {
    leg1MoveStart: leg1.moveStart,
    leg1MoveEnd: leg1.moveEnd,
    leg1WeatherAdjustedMoveMin: leg1.weatherAdjustedMoveMin,
    leg1WaitMin: leg1.waitMin,
    leg2MoveStart: leg2.moveStart,
    leg2MoveEnd: leg2.moveEnd,
    leg2WeatherAdjustedMoveMin: leg2.weatherAdjustedMoveMin,
    leg2WaitMin: leg2.waitMin,
    laborMinutes: labor.laborMinutes,
    overtimeMinutes: labor.overtimeMinutes,
    workedMinutes: labor.workedMinutes,
    totalMoveMin: distanceAgg.totalMoveMin,
    totalDistanceKm: distanceAgg.totalDistanceKm,
    overThresholdCount: distanceAgg.overThresholdCount,
    visitCount: distanceAgg.visitCount,
  };
}

/**
 * 月合計(テンプレート35行目相当)。基準距離超過回数は日次の値の単純合計(SUM(AL4:AL34)相当)。
 * かつてテンプレートのAL35に日次の式が誤ってドラッグコピーされ、月合計距離に式を再適用して
 * 超過回数が過大計上されていた不具合(Ver.1.0.5で修正)を再発させないため。
 */
export function computeMonthlyTotals(days: AttendanceMonthlyDay[]): AttendanceMonthlyTotals {
  const [leg1, leg2] = MOVE_LEGS;
  const sum = (pick: (day: AttendanceMonthlyDay) => number): number =>
    days.reduce((acc, day) => acc + pick(day), 0);
  const sumColumn = (column: keyof AttendanceRowData): number =>
    sum((day) => numberOrZero(day.rowData[column]));

  const leg1Distance = sumColumn(leg1.distanceKm);
  const leg2Distance = sumColumn(leg2.distanceKm);
  const commuteDistance = sumColumn(COMMUTE_DISTANCE_COLUMN);
  const leavingDistance = sumColumn(LEAVING_DISTANCE_COLUMN);

  return {
    laborMinutes: Math.round(sum((d) => d.derived.laborMinutes)),
    overtimeMinutes: round2(sum((d) => d.derived.overtimeMinutes)),
    workedMinutes: Math.round(sum((d) => d.derived.workedMinutes)),
    totalMoveMin: round2(sum((d) => d.derived.totalMoveMin)),
    leg1DistanceKmTotal: round2(leg1Distance),
    leg2DistanceKmTotal: round2(leg2Distance),
    attendanceDistanceKmTotal: round2(commuteDistance),
    leavingDistanceKmTotal: round2(leavingDistance),
    totalDistanceKm: round2(leg1Distance + leg2Distance + commuteDistance + leavingDistance),
    overThresholdCount: sum((d) => d.derived.overThresholdCount),
    visitCountTotal: sum((d) => d.derived.visitCount),
    shoppingErrandTotal: round2(sumColumn(SHOPPING_ERRAND_COLUMN)),
  };
}
