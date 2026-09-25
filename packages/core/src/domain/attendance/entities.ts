import type { TravelLegKind, VisitSource, VisitStatus, WeatherCode } from '../model';

/**
 * 勤怠1日分の実体(タイムゾーンに依存しない形)。時刻は業務日の 0:00 からの分(翌日にまたがる終了は
 * 1440 以上)。暗号化される値(訪問先の表示名・作業内容・備考)は復号済みの平文。
 * DB の行(ports/attendance.ts)との変換は usecases/attendance/records.ts、出勤簿の列(C/D/E…)との変換は
 * sheetLayout.ts の projectDay / applyRowEdit が行う。
 */
export interface VisitEntity {
  id: string;
  /** その日の中の並び(1〜3 が出勤簿の訪問#1〜#3)。 */
  seq: number;
  customerId: string | null;
  /** 訪問先の表示名(出勤簿の「訪問先等」)。 */
  label: string;
  start: number | null;
  end: number | null;
  plannedStart: number | null;
  plannedEnd: number | null;
  status: VisitStatus;
  source: VisitSource;
  externalEventId: string | null;
  overriddenFields: string[];
}

export interface WorkSegmentEntity {
  id: string;
  /** 1〜2 が出勤簿の作業1・2。 */
  seq: number;
  description: string;
  start: number | null;
  end: number | null;
  overriddenFields: string[];
}

export interface TravelLegEntity {
  id: string;
  kind: TravelLegKind;
  /** between の 1 = #1→#2、2 = #2→#3。commute / return は 1。 */
  seq: number;
  plannedMinutes: number | null;
  /** 小数2桁まで。 */
  distanceKm: number | null;
  weather: WeatherCode | null;
  overriddenFields: string[];
}

export interface DayEntity {
  id: string;
  shoppingErrandCount: number | null;
  remarks: string;
  overriddenFields: string[];
}

export interface AttendanceSheetDay {
  day: DayEntity;
  visits: VisitEntity[];
  segments: WorkSegmentEntity[];
  legs: TravelLegEntity[];
}

/** 1つの実体の変更(entity_changes と差分の書き込みに使う)。 */
export interface EntityDiff<T> {
  insert: T[];
  update: { before: T; after: T; changedFields: string[] }[];
  delete: T[];
}

export interface AttendanceSheetDiff {
  day: { before: DayEntity; after: DayEntity; changedFields: string[] } | null;
  visits: EntityDiff<VisitEntity>;
  segments: EntityDiff<WorkSegmentEntity>;
  legs: EntityDiff<TravelLegEntity>;
}

const VISIT_FIELDS = [
  'seq',
  'customerId',
  'label',
  'start',
  'end',
  'plannedStart',
  'plannedEnd',
  'status',
  'source',
  'externalEventId',
  'overriddenFields',
] as const satisfies readonly (keyof VisitEntity)[];
const SEGMENT_FIELDS = [
  'seq',
  'description',
  'start',
  'end',
  'overriddenFields',
] as const satisfies readonly (keyof WorkSegmentEntity)[];
const LEG_FIELDS = [
  'kind',
  'seq',
  'plannedMinutes',
  'distanceKm',
  'weather',
  'overriddenFields',
] as const satisfies readonly (keyof TravelLegEntity)[];
const DAY_FIELDS = [
  'shoppingErrandCount',
  'remarks',
  'overriddenFields',
] as const satisfies readonly (keyof DayEntity)[];

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

function changedFieldsOf<T>(before: T, after: T, fields: readonly (keyof T)[]): string[] {
  return fields.filter((f) => !sameValue(before[f], after[f])).map(String);
}

function diffById<T extends { id: string }>(
  before: T[],
  after: T[],
  fields: readonly (keyof T)[],
): EntityDiff<T> {
  const beforeById = new Map(before.map((e) => [e.id, e]));
  const afterIds = new Set(after.map((e) => e.id));
  const result: EntityDiff<T> = { insert: [], update: [], delete: [] };
  for (const entity of after) {
    const previous = beforeById.get(entity.id);
    if (!previous) {
      result.insert.push(entity);
      continue;
    }
    const changedFields = changedFieldsOf(previous, entity, fields);
    if (changedFields.length > 0) result.update.push({ before: previous, after: entity, changedFields });
  }
  for (const entity of before) if (!afterIds.has(entity.id)) result.delete.push(entity);
  return result;
}

/** 2つの状態の差分(実体の ID で突き合わせる)。 */
export function diffAttendanceSheets(
  before: AttendanceSheetDay,
  after: AttendanceSheetDay,
): AttendanceSheetDiff {
  const dayFields = changedFieldsOf(before.day, after.day, DAY_FIELDS);
  return {
    day: dayFields.length > 0 ? { before: before.day, after: after.day, changedFields: dayFields } : null,
    visits: diffById(before.visits, after.visits, VISIT_FIELDS),
    segments: diffById(before.segments, after.segments, SEGMENT_FIELDS),
    legs: diffById(before.legs, after.legs, LEG_FIELDS),
  };
}

export function isEmptyDiff(diff: AttendanceSheetDiff): boolean {
  const empty = (d: EntityDiff<unknown>) => d.insert.length + d.update.length + d.delete.length === 0;
  return diff.day === null && empty(diff.visits) && empty(diff.segments) && empty(diff.legs);
}

/** 空の1日(入れ物だけ)。 */
export function emptySheetDay(dayId: string): AttendanceSheetDay {
  return {
    day: { id: dayId, shoppingErrandCount: null, remarks: '', overriddenFields: [] },
    visits: [],
    segments: [],
    legs: [],
  };
}
