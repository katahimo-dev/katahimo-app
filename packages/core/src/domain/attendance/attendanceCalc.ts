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
 * 出勤簿テンプレート(出勤簿テンプレート.xlsx)の数式を再現した純粋計算関数群。
 *
 * 移植元: gas-childcare-visit-app/AttendanceCalc.js(webapp-poc/server/attendanceCalc.jsと
 * バイト単位で同一のロジック)。ロジックは一切変更せず、型を付けただけの移植。
 * 給与計算に直結するため(Ver.1.0.5で「AL35に日次の式がそのままドラッグコピーされ、
 * 月合計の基準距離超過回数が過大計上されていた」不具合が発生した実績がある)、
 * このファイルの計算式は実データでGAS版と数値が完全一致することを確認してから
 * 本番切替すること(移行計画のPhase 6検証ゲート)。
 */

const CORE_START_MIN = 10 * 60; // 10:00
const CORE_END_MIN = 17 * 60; // 17:00
const OVER_THRESHOLD_KM = 15;
const OVER_THRESHOLD_STEP_KM = 5;
const SNOW_MOVE_MULTIPLIER = 1.3;

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

/** computeMoveChainの戻り値(number | '')を、'' なら0として扱う。 */
function numOrZero(v: number | ''): number {
  return v === '' ? 0 : v;
}

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
    planned === null ? null : weather === '雪' ? planned * SNOW_MOVE_MULTIPLIER : planned;

  let moveEndMin: number | null = null;
  if (moveStartMin !== null && planned !== null) {
    moveEndMin = moveStartMin + planned;
  }

  let waitMin: number | null = null;
  if (moveEndMin !== null && nextStartMin !== null) {
    waitMin = Math.max(0, nextStartMin - moveEndMin);
  }

  return {
    moveStart: moveStartMin === null ? '' : formatMinutesToTime(moveStartMin),
    moveEnd: moveEndMin === null ? '' : formatMinutesToTime(moveEndMin),
    weatherAdjustedMoveMin:
      weatherAdjustedMoveMin === null ? '' : Math.round(weatherAdjustedMoveMin * 100) / 100,
    waitMin: waitMin === null ? '' : Math.round(waitMin),
  };
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
 */
export function computeLaborAndOvertime(rowData: AttendanceRowData): LaborAndOvertime {
  const blocks = [
    { start: rowData.D, end: rowData.E, mtg: false },
    { start: rowData.M, end: rowData.N, mtg: false },
    { start: rowData.V, end: rowData.W, mtg: false },
    { start: rowData.Y, end: rowData.Z, mtg: isMtgLabel(rowData.X) },
    { start: rowData.AB, end: rowData.AC, mtg: isMtgLabel(rowData.AA) },
  ];

  let laborMinutes = 0;
  let overtimeMinutes = 0;
  for (const b of blocks) {
    const { core, overtime } = splitCoreAndOvertimeMinutes(b.start, b.end, b.mtg);
    laborMinutes += core;
    overtimeMinutes += overtime;
  }

  return {
    laborMinutes: Math.round(laborMinutes),
    overtimeMinutes: Math.round(overtimeMinutes * 100) / 100,
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
 * AM(訪問等回数)相当: AH(#2移動距離)が数値なら3、AG(#1移動距離)が数値なら2、
 * AI/AJ(出勤/退勤距離)のどちらかが数値なら1、それ以外は0。
 */
export function computeVisitCount(rowData: AttendanceRowData): number {
  const ag = toNumberOrNull(rowData.AG);
  const ah = toNumberOrNull(rowData.AH);
  const ai = toNumberOrNull(rowData.AI);
  const aj = toNumberOrNull(rowData.AJ);
  if (ah !== null) return 3;
  if (ag !== null) return 2;
  if (ai !== null || aj !== null) return 1;
  return 0;
}

/**
 * AF/AK/AL/AM相当。leg1MoveMin/leg2MoveMinは天候補正後の値(J/S)を使う。
 */
export function computeDistanceAggregates(
  rowData: AttendanceRowData,
  leg1WeatherAdjustedMoveMin: number | '',
  leg2WeatherAdjustedMoveMin: number | '',
): DistanceAggregates {
  const j = numOrZero(leg1WeatherAdjustedMoveMin);
  const s = numOrZero(leg2WeatherAdjustedMoveMin);
  const ag = toNumberOrNull(rowData.AG) || 0;
  const ah = toNumberOrNull(rowData.AH) || 0;
  const ai = toNumberOrNull(rowData.AI) || 0;
  const aj = toNumberOrNull(rowData.AJ) || 0;

  return {
    totalMoveMin: Math.round((j + s) * 100) / 100,
    totalDistanceKm: Math.round((ag + ah + ai + aj) * 100) / 100,
    overThresholdCount: countOverThreshold([rowData.AG, rowData.AH, rowData.AI, rowData.AJ]),
    visitCount: computeVisitCount(rowData),
  };
}

/**
 * 1日分のrow_dataから、テンプレートの数式列に相当する派生値をすべて計算する。
 */
export function computeDayDerived(rowData: AttendanceRowData | undefined | null): AttendanceDayDerived {
  const data = rowData ?? {};
  const leg1 = computeMoveChain(data.E, data.H, data.I, data.M);
  const leg2 = computeMoveChain(data.N, data.Q, data.R, data.V);
  const { laborMinutes, overtimeMinutes } = computeLaborAndOvertime(data);
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
    laborMinutes,
    overtimeMinutes,
    totalMoveMin: distanceAgg.totalMoveMin,
    totalDistanceKm: distanceAgg.totalDistanceKm,
    overThresholdCount: distanceAgg.overThresholdCount,
    visitCount: distanceAgg.visitCount,
  };
}

/**
 * 月合計(テンプレート35行目相当)。ALは日次ALの合計(SUM(AL4:AL34)相当)。
 * かつてテンプレートのAL35に、SUMではなく日次の超過回数の式が誤ってそのまま
 * ドラッグコピーされていた不具合(月合計distanceに対して式を再適用してしまい
 * 超過回数が過大計上される)があったため、日次の値を単純合計する形に修正済み
 * (Ver.1.0.5、01_GAS/CHANGELOG.md参照)。
 */
export function computeMonthlyTotals(days: AttendanceMonthlyDay[]): AttendanceMonthlyTotals {
  let laborMinutes = 0;
  let overtimeMinutes = 0;
  let totalMoveMin = 0;
  let sumAG = 0;
  let sumAH = 0;
  let sumAI = 0;
  let sumAJ = 0;
  let overThresholdCount = 0;
  let visitCountTotal = 0;
  let shoppingErrandTotal = 0;

  for (const { rowData, derived } of days) {
    laborMinutes += derived.laborMinutes;
    overtimeMinutes += derived.overtimeMinutes;
    totalMoveMin += derived.totalMoveMin;
    sumAG += toNumberOrNull(rowData.AG) || 0;
    sumAH += toNumberOrNull(rowData.AH) || 0;
    sumAI += toNumberOrNull(rowData.AI) || 0;
    sumAJ += toNumberOrNull(rowData.AJ) || 0;
    overThresholdCount += derived.overThresholdCount;
    visitCountTotal += derived.visitCount;
    shoppingErrandTotal += toNumberOrNull(rowData.AN) || 0;
  }

  const totalDistanceKm = Math.round((sumAG + sumAH + sumAI + sumAJ) * 100) / 100;

  return {
    laborMinutes: Math.round(laborMinutes),
    overtimeMinutes: Math.round(overtimeMinutes * 100) / 100,
    totalMoveMin: Math.round(totalMoveMin * 100) / 100,
    leg1DistanceKmTotal: Math.round(sumAG * 100) / 100,
    leg2DistanceKmTotal: Math.round(sumAH * 100) / 100,
    attendanceDistanceKmTotal: Math.round(sumAI * 100) / 100,
    leavingDistanceKmTotal: Math.round(sumAJ * 100) / 100,
    totalDistanceKm,
    overThresholdCount,
    visitCountTotal,
    shoppingErrandTotal: Math.round(shoppingErrandTotal * 100) / 100,
  };
}
