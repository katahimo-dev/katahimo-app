import type { AttendanceColumnKey } from '@katahimo/shared';
import { invalid } from '../errors';
import type { WeatherCode } from '../model';
import type {
  AttendanceSheetDay,
  DayEntity,
  TravelLegEntity,
  VisitEntity,
  WorkSegmentEntity,
} from './entities';
import type { AttendanceRowData, AttendanceRowPatch } from './types';

/**
 * 出勤簿テンプレート(個別出勤簿スプレッドシート)の列レイアウト。
 *
 * 列記号(C/D/E…)と業務上の意味(訪問#1の始業時刻、#1→#2の移動距離…)の対応を持つのは
 * このファイルだけ。計算・カレンダー反映などの業務ロジックは、列記号を直接書かずに
 * ここの名前付き定義(VISIT_SLOTS / MOVE_LEGS 等)を経由して rowData を読み書きする。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の PAST_SCHEDULE_INPUT_COLUMNS /
 * PAST_SCHEDULE_SYNC_SLOTS、AttendanceCalc.js のコメント(列ごとの意味)。
 *
 * DB は出勤簿の行を持たず、1日を訪問(visits)・業務時間(work_segments)・移動(travel_legs)・入れ物
 * (attendance_days)の実体で持つ。projectDay(実体 → 行)と applyRowEdit(行の編集 → 実体)が両者を
 * 行き来する唯一の場所で、画面(rowData)・計算(attendanceCalc)・GAS版への書き戻しは行の形のまま扱う。
 */

export type { AttendanceColumnKey } from '@katahimo/shared';
export { ATTENDANCE_COLUMN_KEYS } from '@katahimo/shared';

export type AttendanceColumnKind = 'text' | 'time' | 'number' | 'select';

/** 各入力列の表示名と入力種別(GAS版 PAST_SCHEDULE_INPUT_COLUMNS と同じ)。 */
export const ATTENDANCE_COLUMNS: Readonly<
  Record<AttendanceColumnKey, { label: string; kind: AttendanceColumnKind }>
> = {
  C: { kind: 'text', label: '#1訪問先等' },
  D: { kind: 'time', label: '#1始業時刻' },
  E: { kind: 'time', label: '#1終業時刻' },
  AI: { kind: 'number', label: '#1出勤距離' },
  I: { kind: 'select', label: '天候' },
  H: { kind: 'number', label: '#1→#2移動時間' },
  L: { kind: 'text', label: '#2訪問先等' },
  M: { kind: 'time', label: '#2始業時刻' },
  N: { kind: 'time', label: '#2終業時刻' },
  AG: { kind: 'number', label: '#1→#2移動距離' },
  R: { kind: 'select', label: '天候' },
  Q: { kind: 'number', label: '#2→#3移動時間' },
  U: { kind: 'text', label: '#3訪問先等' },
  V: { kind: 'time', label: '#3始業時刻' },
  W: { kind: 'time', label: '#3終業時刻' },
  AH: { kind: 'number', label: '#2→#3移動距離' },
  AJ: { kind: 'number', label: '退勤距離' },
  X: { kind: 'text', label: '作業１' },
  Y: { kind: 'time', label: '作業１開始' },
  Z: { kind: 'time', label: '作業１終了' },
  AA: { kind: 'text', label: '作業２' },
  AB: { kind: 'time', label: '作業２開始' },
  AC: { kind: 'time', label: '作業２終了' },
  AN: { kind: 'number', label: '買物代行' },
  AO: { kind: 'text', label: '備考' },
};

export type AttendanceSlotKey = 'slot1' | 'slot2' | 'slot3' | 'office1' | 'office2';

/** 1つの時間帯(訪問 or 事務作業)。title=訪問先/作業内容、start/end=開始/終了時刻の列。 */
export interface AttendanceTimeSlot {
  key: AttendanceSlotKey;
  kind: 'visit' | 'office';
  title: AttendanceColumnKey;
  start: AttendanceColumnKey;
  end: AttendanceColumnKey;
  /**
   * カレンダー反映でこの時間帯と一緒に書き換える列(GAS版 PAST_SCHEDULE_SYNC_SLOTS の cols、順序も同じ)。
   * 訪問#2/#3は直前からの移動時間・移動距離、訪問#1は出勤距離を含む。
   */
  syncColumns: readonly AttendanceColumnKey[];
}

/** 出勤距離(自宅→最初の訪問先)。 */
export const COMMUTE_DISTANCE_COLUMN: AttendanceColumnKey = 'AI';
/** 退勤距離(最後の訪問先→自宅)。訪問件数によって#1〜#3のどれかに付随する。 */
export const LEAVING_DISTANCE_COLUMN: AttendanceColumnKey = 'AJ';
/** 買物代行。 */
export const SHOPPING_ERRAND_COLUMN: AttendanceColumnKey = 'AN';
/** 備考。 */
export const REMARKS_COLUMN: AttendanceColumnKey = 'AO';

export const VISIT_SLOTS: readonly [AttendanceTimeSlot, AttendanceTimeSlot, AttendanceTimeSlot] = [
  { key: 'slot1', kind: 'visit', title: 'C', start: 'D', end: 'E', syncColumns: ['C', 'D', 'E', 'AI'] },
  { key: 'slot2', kind: 'visit', title: 'L', start: 'M', end: 'N', syncColumns: ['H', 'L', 'M', 'N', 'AG'] },
  { key: 'slot3', kind: 'visit', title: 'U', start: 'V', end: 'W', syncColumns: ['Q', 'U', 'V', 'W', 'AH'] },
];

export const OFFICE_SLOTS: readonly [AttendanceTimeSlot, AttendanceTimeSlot] = [
  { key: 'office1', kind: 'office', title: 'X', start: 'Y', end: 'Z', syncColumns: ['X', 'Y', 'Z'] },
  { key: 'office2', kind: 'office', title: 'AA', start: 'AB', end: 'AC', syncColumns: ['AA', 'AB', 'AC'] },
];

/** 訪問#1〜#3・事務作業#1〜#2の順(GAS版 PAST_SCHEDULE_SYNC_SLOTS と同じ順序)。 */
export const ATTENDANCE_SLOTS: readonly AttendanceTimeSlot[] = [...VISIT_SLOTS, ...OFFICE_SLOTS];

/** 訪問間の移動(#1→#2、#2→#3)。計画移動時間・移動後の天候・移動距離の列。 */
export interface MoveLeg {
  from: AttendanceTimeSlot;
  to: AttendanceTimeSlot;
  plannedMinutes: AttendanceColumnKey;
  weather: AttendanceColumnKey;
  distanceKm: AttendanceColumnKey;
}

export const MOVE_LEGS: readonly [MoveLeg, MoveLeg] = [
  { from: VISIT_SLOTS[0], to: VISIT_SLOTS[1], plannedMinutes: 'H', weather: 'I', distanceKm: 'AG' },
  { from: VISIT_SLOTS[1], to: VISIT_SLOTS[2], plannedMinutes: 'Q', weather: 'R', distanceKm: 'AH' },
];

/**
 * 天候の選択肢。GAS版はシート(I5/R5セル)の入力規則から読み、読めない場合は画面側で
 * この4つにフォールバックしていた。移動時間の積雪補正は '雪' のときだけ掛かる。
 */
export const WEATHER_OPTIONS: readonly string[] = ['晴れ', '曇り', '雨', '雪'];
export const SNOW_WEATHER = '雪';

/** 天候のコード(travel_legs.weather)と出勤簿の表示名。 */
const WEATHER_LABELS: Readonly<Record<WeatherCode, string>> = {
  sunny: '晴れ',
  cloudy: '曇り',
  rain: '雨',
  snow: '雪',
};

// ─────────────────────────────────────────────────────────────
// 実体 ↔ 列
// ─────────────────────────────────────────────────────────────

type CellTarget =
  | { entity: 'visit'; seq: number; field: 'label' | 'start' | 'end' }
  | { entity: 'segment'; seq: number; field: 'description' | 'start' | 'end' }
  | {
      entity: 'leg';
      kind: TravelLegEntity['kind'];
      seq: number;
      field: 'plannedMinutes' | 'weather' | 'distanceKm';
    }
  | { entity: 'day'; field: 'shoppingErrandCount' | 'remarks' };

/** 各列が実体のどの項目か。 */
const CELL_TARGETS: Readonly<Record<AttendanceColumnKey, CellTarget>> = (() => {
  const targets: Partial<Record<AttendanceColumnKey, CellTarget>> = {};
  VISIT_SLOTS.forEach((slot, i) => {
    targets[slot.title] = { entity: 'visit', seq: i + 1, field: 'label' };
    targets[slot.start] = { entity: 'visit', seq: i + 1, field: 'start' };
    targets[slot.end] = { entity: 'visit', seq: i + 1, field: 'end' };
  });
  OFFICE_SLOTS.forEach((slot, i) => {
    targets[slot.title] = { entity: 'segment', seq: i + 1, field: 'description' };
    targets[slot.start] = { entity: 'segment', seq: i + 1, field: 'start' };
    targets[slot.end] = { entity: 'segment', seq: i + 1, field: 'end' };
  });
  MOVE_LEGS.forEach((leg, i) => {
    targets[leg.plannedMinutes] = { entity: 'leg', kind: 'between', seq: i + 1, field: 'plannedMinutes' };
    targets[leg.weather] = { entity: 'leg', kind: 'between', seq: i + 1, field: 'weather' };
    targets[leg.distanceKm] = { entity: 'leg', kind: 'between', seq: i + 1, field: 'distanceKm' };
  });
  targets[COMMUTE_DISTANCE_COLUMN] = { entity: 'leg', kind: 'commute', seq: 1, field: 'distanceKm' };
  targets[LEAVING_DISTANCE_COLUMN] = { entity: 'leg', kind: 'return', seq: 1, field: 'distanceKm' };
  targets[SHOPPING_ERRAND_COLUMN] = { entity: 'day', field: 'shoppingErrandCount' };
  targets[REMARKS_COLUMN] = { entity: 'day', field: 'remarks' };
  return targets as Record<AttendanceColumnKey, CellTarget>;
})();

/** 実体の overridden_fields に入る意味の名前(人が手で変えた項目)。 */
const OVERRIDE_NAMES = {
  visit: { label: 'label', start: 'actual_start', end: 'actual_end' },
  segment: { description: 'description', start: 'start', end: 'end' },
  leg: { plannedMinutes: 'planned_minutes', weather: 'weather', distanceKm: 'distance_km' },
  day: { shoppingErrandCount: 'shopping_errand_count', remarks: 'remarks' },
} as const;

const COLUMN_ORDER = Object.keys(ATTENDANCE_COLUMNS) as AttendanceColumnKey[];

/** 出勤簿の枠に載る訪問の数(4件目以降は保存するが出勤簿には出ない)。 */
export const SHEET_VISIT_SLOT_COUNT = VISIT_SLOTS.length;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatClock(minutes: number | null): string {
  if (minutes === null) return '';
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function formatKm(km: number | null): string {
  return km === null ? '' : km.toFixed(2);
}

function formatInt(n: number | null): string {
  return n === null ? '' : String(n);
}

function findLeg(sheet: AttendanceSheetDay, kind: TravelLegEntity['kind'], seq: number) {
  return sheet.legs.find((l) => l.kind === kind && l.seq === seq);
}

function cellOf(sheet: AttendanceSheetDay, target: CellTarget): string {
  switch (target.entity) {
    case 'visit': {
      const visit = sheet.visits.find((v) => v.seq === target.seq);
      if (!visit) return '';
      return target.field === 'label' ? visit.label : formatClock(visit[target.field]);
    }
    case 'segment': {
      const segment = sheet.segments.find((s) => s.seq === target.seq);
      if (!segment) return '';
      return target.field === 'description' ? segment.description : formatClock(segment[target.field]);
    }
    case 'leg': {
      const leg = findLeg(sheet, target.kind, target.seq);
      if (!leg) return '';
      if (target.field === 'weather') return leg.weather ? WEATHER_LABELS[leg.weather] : '';
      return target.field === 'distanceKm' ? formatKm(leg.distanceKm) : formatInt(leg.plannedMinutes);
    }
    case 'day':
      return target.field === 'remarks' ? sheet.day.remarks : formatInt(sheet.day.shoppingErrandCount);
  }
}

function overrideNameOf(target: CellTarget): string {
  switch (target.entity) {
    case 'visit':
      return OVERRIDE_NAMES.visit[target.field];
    case 'segment':
      return OVERRIDE_NAMES.segment[target.field];
    case 'leg':
      return OVERRIDE_NAMES.leg[target.field];
    case 'day':
      return OVERRIDE_NAMES.day[target.field];
  }
}

function overriddenFieldsOf(sheet: AttendanceSheetDay, target: CellTarget): readonly string[] {
  switch (target.entity) {
    case 'visit':
      return sheet.visits.find((v) => v.seq === target.seq)?.overriddenFields ?? [];
    case 'segment':
      return sheet.segments.find((s) => s.seq === target.seq)?.overriddenFields ?? [];
    case 'leg':
      return findLeg(sheet, target.kind, target.seq)?.overriddenFields ?? [];
    case 'day':
      return sheet.day.overriddenFields;
  }
}

export interface DayProjection {
  /** 全25列(空は '')。 */
  rowData: Record<AttendanceColumnKey, string>;
  /** 人が手で変えた列(出勤簿で背景色 #fce4e4 が付くセル)。 */
  changedFields: AttendanceColumnKey[];
  /** 出勤簿の枠(3つ)に載らない訪問の数。 */
  hiddenVisitCount: number;
}

/** 1日分の実体を出勤簿の行にする。 */
export function projectDay(sheet: AttendanceSheetDay): DayProjection {
  const rowData = {} as Record<AttendanceColumnKey, string>;
  const changedFields: AttendanceColumnKey[] = [];
  for (const column of COLUMN_ORDER) {
    const target = CELL_TARGETS[column];
    rowData[column] = cellOf(sheet, target);
    if (overriddenFieldsOf(sheet, target).includes(overrideNameOf(target))) changedFields.push(column);
  }
  return {
    rowData,
    changedFields,
    hiddenVisitCount: sheet.visits.filter((v) => v.seq > SHEET_VISIT_SLOT_COUNT).length,
  };
}

/** 空の列を除いた行(画面に返す形)。 */
export function compactRowData(rowData: Record<string, string>): AttendanceRowData {
  return Object.fromEntries(Object.entries(rowData).filter(([, v]) => v !== '')) as AttendanceRowData;
}

// ── 入力値の解釈(列の種類ごとの正規の表記に揃える) ──

type ParsedCell =
  | { kind: 'text'; value: string }
  | { kind: 'clock'; value: number | null }
  | { kind: 'int'; value: number | null }
  | { kind: 'km'; value: number | null }
  | { kind: 'weather'; value: WeatherCode | null };

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function parseCell(column: AttendanceColumnKey, raw: string): ParsedCell | { error: string } {
  const target = CELL_TARGETS[column];
  const value = raw.trim();
  const isText =
    (target.entity === 'visit' && target.field === 'label') ||
    (target.entity === 'segment' && target.field === 'description') ||
    (target.entity === 'day' && target.field === 'remarks');
  if (isText) return { kind: 'text', value: raw };
  if (target.entity === 'leg' && target.field === 'weather') {
    if (value === '') return { kind: 'weather', value: null };
    const code = (Object.keys(WEATHER_LABELS) as WeatherCode[]).find((c) => WEATHER_LABELS[c] === value);
    return code ? { kind: 'weather', value: code } : { error: '天候は選択肢から選んでください' };
  }
  if (target.entity === 'leg' && target.field === 'distanceKm') {
    if (value === '') return { kind: 'km', value: null };
    if (!/^\d{1,4}(\.\d+)?$/.test(value)) return { error: '距離は数値(km)で入力してください' };
    return { kind: 'km', value: Math.round(Number(value) * 100) / 100 };
  }
  if ((target.entity === 'leg' && target.field === 'plannedMinutes') || target.entity === 'day') {
    if (value === '') return { kind: 'int', value: null };
    if (!/^\d{1,4}$/.test(value)) return { error: '0以上の整数で入力してください' };
    return { kind: 'int', value: Number(value) };
  }
  if (value === '') return { kind: 'clock', value: null };
  const match = TIME_PATTERN.exec(value);
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  if (!match || hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
    return { error: '時刻は HH:MM の形式で入力してください' };
  }
  return { kind: 'clock', value: hours * 60 + minutes };
}

function formatParsed(parsed: ParsedCell): string {
  switch (parsed.kind) {
    case 'text':
      return parsed.value;
    case 'clock':
      return formatClock(parsed.value);
    case 'int':
      return formatInt(parsed.value);
    case 'km':
      return formatKm(parsed.value);
    case 'weather':
      return parsed.value ? WEATHER_LABELS[parsed.value] : '';
  }
}

/**
 * 行の値を列の種類ごとの正規の表記に揃える(時刻 'HH:mm'・距離は小数2桁・整数)。解釈できない値は
 * そのまま残す(カレンダー由来の値を出勤簿と同じ表記で比べるため。比べた結果の書き込みは applyRowEdit が検証する)。
 */
export function canonicalizeRowData(rowData: AttendanceRowData): AttendanceRowData {
  const result: AttendanceRowData = {};
  for (const column of COLUMN_ORDER) {
    const raw = rowData[column];
    if (raw === undefined) continue;
    const parsed = parseCell(column, raw);
    result[column] = 'error' in parsed ? raw : formatParsed(parsed);
  }
  return result;
}

export interface CellChange {
  column: AttendanceColumnKey;
  label: string;
  oldValue: string;
  newValue: string;
}

export interface RowEditOptions {
  /** user: 手入力(変えた項目を overridden_fields に加える)/ calendar_sync: カレンダー反映(加えない)。 */
  source: 'user' | 'calendar_sync';
  newId: () => string;
}

function blankVisit(id: string, seq: number, source: RowEditOptions['source']): VisitEntity {
  return {
    id,
    seq,
    customerId: null,
    label: '',
    start: null,
    end: null,
    plannedStart: null,
    plannedEnd: null,
    status: 'completed',
    source: source === 'user' ? 'manual' : 'google_calendar',
    externalEventId: null,
    overriddenFields: [],
  };
}

function blankSegment(id: string, seq: number): WorkSegmentEntity {
  return { id, seq, description: '', start: null, end: null, overriddenFields: [] };
}

function blankLeg(id: string, kind: TravelLegEntity['kind'], seq: number): TravelLegEntity {
  return { id, kind, seq, plannedMinutes: null, distanceKm: null, weather: null, overriddenFields: [] };
}

function addOverride(entity: { overriddenFields: string[] }, name: string): void {
  if (!entity.overriddenFields.includes(name)) entity.overriddenFields = [...entity.overriddenFields, name];
}

/** 終了を開始から24時間未満の位置に置く(終了が開始より前なら翌日とみなす。GAS版の所要時間の計算と同じ)。 */
function normalizeSpan<T extends { start: number | null; end: number | null }>(entity: T): void {
  if (entity.start === null || entity.end === null) return;
  const end = entity.end % 1440;
  entity.end = end < entity.start ? end + 1440 : end;
}

function overlapError(visits: VisitEntity[]): string | null {
  const timed = visits
    .filter((v) => v.start !== null && v.end !== null)
    .sort((a, b) => (a.start as number) - (b.start as number));
  for (let i = 1; i < timed.length; i++) {
    const previous = timed[i - 1] as VisitEntity;
    const current = timed[i] as VisitEntity;
    if ((current.start as number) < (previous.end as number)) {
      return `訪問#${previous.seq}と#${current.seq}の時間が重なっています。時刻を確かめてください。`;
    }
  }
  return null;
}

/**
 * 出勤簿の行の編集(送られた列だけ)を実体に当てる。値の変わった列だけを変え、変わった列の一覧を返す
 * (GAS版 updatePastSchedule の「変更されたセルだけ書き込む」と同じ)。
 * - 列の値は種類ごとに検証する(時刻 HH:MM・整数・距離・天候の選択肢)。不正なら validation_failed。
 * - 訪問・作業・移動の列が全て空になった実体は消す。空だった枠に値が入れば実体を作る。
 * - source = 'user' なら変えた項目を overridden_fields に加える(カレンダー反映は加えも消しもしない)。
 * - 同じ日の訪問の時間が重なる場合は validation_failed(DB の EXCLUDE 制約と同じ規則)。
 */
export function applyRowEdit(
  sheet: AttendanceSheetDay,
  patch: AttendanceRowPatch,
  options: RowEditOptions,
): { next: AttendanceSheetDay; changes: CellChange[] } {
  const { rowData: current } = projectDay(sheet);
  const changes: CellChange[] = [];
  const parsedByColumn = new Map<AttendanceColumnKey, ParsedCell>();
  const errors: Record<string, string> = {};
  for (const column of COLUMN_ORDER) {
    const raw = patch[column];
    if (raw === undefined) continue;
    const parsed = parseCell(column, raw);
    if ('error' in parsed) {
      errors[`rowData.${column}`] = `${ATTENDANCE_COLUMNS[column].label}: ${parsed.error}`;
      continue;
    }
    const newValue = formatParsed(parsed);
    if (newValue === current[column]) continue;
    parsedByColumn.set(column, parsed);
    changes.push({ column, label: ATTENDANCE_COLUMNS[column].label, oldValue: current[column], newValue });
  }
  const firstError = Object.values(errors)[0];
  if (firstError) throw invalid(firstError, errors);
  if (changes.length === 0) return { next: sheet, changes };

  const next: AttendanceSheetDay = structuredClone(sheet);
  const touchedVisits = new Set<VisitEntity>();
  for (const { column } of changes) {
    const target = CELL_TARGETS[column];
    const parsed = parsedByColumn.get(column) as ParsedCell;
    const override = (entity: { overriddenFields: string[] }) => {
      if (options.source === 'user') addOverride(entity, overrideNameOf(target));
    };
    switch (target.entity) {
      case 'visit': {
        let visit = next.visits.find((v) => v.seq === target.seq);
        if (!visit) {
          visit = blankVisit(options.newId(), target.seq, options.source);
          next.visits.push(visit);
        }
        if (target.field === 'label') visit.label = (parsed as { value: string }).value;
        else visit[target.field] = (parsed as { value: number | null }).value;
        if (options.source === 'calendar_sync') visit.source = 'google_calendar';
        touchedVisits.add(visit);
        override(visit);
        break;
      }
      case 'segment': {
        let segment = next.segments.find((s) => s.seq === target.seq);
        if (!segment) {
          segment = blankSegment(options.newId(), target.seq);
          next.segments.push(segment);
        }
        if (target.field === 'description') segment.description = (parsed as { value: string }).value;
        else segment[target.field] = (parsed as { value: number | null }).value;
        override(segment);
        break;
      }
      case 'leg': {
        let leg = findLeg(next, target.kind, target.seq);
        if (!leg) {
          leg = blankLeg(options.newId(), target.kind, target.seq);
          next.legs.push(leg);
        }
        if (target.field === 'weather') leg.weather = (parsed as { value: WeatherCode | null }).value;
        else leg[target.field] = (parsed as { value: number | null }).value;
        override(leg);
        break;
      }
      case 'day': {
        const day: DayEntity = next.day;
        if (target.field === 'remarks') day.remarks = (parsed as { value: string }).value;
        else day.shoppingErrandCount = (parsed as { value: number | null }).value;
        override(day);
        break;
      }
    }
  }

  for (const visit of next.visits) normalizeSpan(visit);
  for (const segment of next.segments) normalizeSpan(segment);
  if (options.source === 'calendar_sync') {
    for (const visit of touchedVisits) {
      visit.plannedStart = visit.start;
      visit.plannedEnd = visit.end;
    }
  }
  next.visits = next.visits.filter((v) => v.label !== '' || v.start !== null || v.end !== null);
  next.segments = next.segments.filter((s) => s.description !== '' || s.start !== null || s.end !== null);
  next.legs = next.legs.filter(
    (l) => l.plannedMinutes !== null || l.distanceKm !== null || l.weather !== null,
  );

  const overlap = overlapError(next.visits);
  if (overlap) throw invalid(overlap, { rowData: overlap }, 'visit_overlap');
  return { next, changes };
}
