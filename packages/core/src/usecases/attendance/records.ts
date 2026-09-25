import {
  type AttendanceColumnKey,
  type AttendanceSheetDay,
  diffAttendanceSheets,
  type EntityDiff,
  isEmptyDiff,
  minutesSinceZonedMidnight,
  newId,
  outboxDedupeKey,
  ENCRYPTION_PURPOSES as P,
  type TravelLegEntity,
  type VisitEntity,
  type WorkSegmentEntity,
  zonedInstant,
} from '../../domain';
import type { ChangeSource, EntityType } from '../../domain/model';
import type {
  AttendanceDayRow,
  AttendanceDayRows,
  AttendanceDayWrite,
  InstantRangeValue,
  TravelLegRow,
  VisitRow,
  WorkSegmentRow,
} from '../../ports/attendance';
import type { CryptoPort } from '../../ports/crypto';
import type { TenantRepositories } from '../../ports/unitOfWork';

/**
 * 勤怠の DB の行(ports/attendance.ts)と、タイムゾーンに依存しない実体(domain/attendance/entities.ts)の変換。
 * 時刻の範囲 ↔ 業務日の 0:00 からの分はテナントのタイムゾーンで変換し、暗号化した値(訪問先の表示名・
 * 作業内容・備考)はここで復号・暗号化する。
 */

function toMinutes(range: InstantRangeValue | null, date: string, timeZone: string) {
  return {
    start: range?.start ? minutesSinceZonedMidnight(range.start, date, timeZone) : null,
    end: range?.end ? minutesSinceZonedMidnight(range.end, date, timeZone) : null,
  };
}

function toRange(
  start: number | null,
  end: number | null,
  date: string,
  timeZone: string,
): InstantRangeValue | null {
  if (start === null && end === null) return null;
  return {
    start: start === null ? null : zonedInstant(date, start, timeZone),
    end: end === null ? null : zonedInstant(date, end, timeZone),
  };
}

/** DB の1日分を実体にする(復号する)。 */
export async function toSheetDay(
  crypto: CryptoPort,
  tenantId: string,
  timeZone: string,
  rows: AttendanceDayRows,
): Promise<AttendanceSheetDay> {
  const date = rows.businessDate;
  const decrypt = (purpose: (typeof P)[keyof typeof P], rowId: string, value: Uint8Array | null) =>
    value ? crypto.decrypt({ tenantId, purpose, rowId }, value) : Promise.resolve('');
  return {
    day: {
      id: rows.day?.id ?? '',
      shoppingErrandCount: rows.day?.shoppingErrandCount ?? null,
      remarks: rows.day ? await decrypt(P.attendanceRemarks, rows.day.id, rows.day.remarksEnc) : '',
      overriddenFields: rows.day?.overriddenFields ?? [],
    },
    visits: await Promise.all(
      rows.visits.map(async (v): Promise<VisitEntity> => {
        const actual = toMinutes(v.actualPeriod, date, timeZone);
        const planned = toMinutes(v.plannedPeriod, date, timeZone);
        return {
          id: v.id,
          seq: v.seq,
          customerId: v.customerId,
          label: await decrypt(P.visitLabel, v.id, v.labelEnc),
          start: actual.start,
          end: actual.end,
          plannedStart: planned.start,
          plannedEnd: planned.end,
          status: v.status,
          source: v.source,
          externalEventId: v.externalEventId,
          overriddenFields: v.overriddenFields,
        };
      }),
    ),
    segments: await Promise.all(
      rows.segments.map(
        async (s): Promise<WorkSegmentEntity> => ({
          id: s.id,
          seq: s.seq,
          description: await decrypt(P.workSegmentDescription, s.id, s.descriptionEnc),
          ...toMinutes(s.period, date, timeZone),
          overriddenFields: s.overriddenFields,
        }),
      ),
    ),
    legs: rows.legs.map(
      (l): TravelLegEntity => ({
        id: l.id,
        kind: l.kind,
        seq: l.seq,
        plannedMinutes: l.plannedMinutes,
        distanceKm: l.distanceKm === null ? null : Number(l.distanceKm),
        weather: l.weather,
        overriddenFields: l.overriddenFields,
      }),
    ),
  };
}

export interface SheetWriteContext {
  crypto: CryptoPort;
  timeZone: string;
  changedBy: string | null;
  changeSource: ChangeSource;
}

/**
 * 変更前の値を履歴の用途で暗号化して entity_changes に追記する。before は書き残す値そのもの
 * (更新は変わった項目だけ、削除は実体の全ての項目)。
 */
async function appendChange(
  r: TenantRepositories,
  ctx: SheetWriteContext,
  entityType: EntityType,
  entityId: string,
  changedFields: string[],
  before: Record<string, unknown> | null,
): Promise<void> {
  const id = newId();
  const beforeEnc = before
    ? await ctx.crypto.encrypt(
        { tenantId: r.tenantId, purpose: P.entityChangeBefore, rowId: id },
        JSON.stringify(before),
      )
    : null;
  await r.entityChanges.append({
    id,
    entityType,
    entityId,
    changedBy: ctx.changedBy,
    changeSource: ctx.changeSource,
    changedFields,
    beforeEnc,
  });
}

/** 変わった項目だけの変更前の値。 */
function pickFields(before: object, fields: string[]): Record<string, unknown> {
  const values = before as Record<string, unknown>;
  return Object.fromEntries(fields.map((f) => [f, values[f] ?? null]));
}

/** 削除した実体の全ての項目(ID は entity_id に残るため除く。削除した行を後から復元できるように)。 */
function wholeEntity(entity: { id: string }): Record<string, unknown> {
  const { id: _id, ...values } = entity as { id: string } & Record<string, unknown>;
  return values;
}

async function recordHistory<T extends { id: string }>(
  r: TenantRepositories,
  ctx: SheetWriteContext,
  entityType: EntityType,
  diff: EntityDiff<T>,
  fieldsOf: (entity: T) => string[],
): Promise<void> {
  for (const e of diff.insert) await appendChange(r, ctx, entityType, e.id, fieldsOf(e), null);
  for (const u of diff.update) {
    await appendChange(
      r,
      ctx,
      entityType,
      u.after.id,
      u.changedFields,
      pickFields(u.before, u.changedFields),
    );
  }
  for (const e of diff.delete) {
    await appendChange(r, ctx, entityType, e.id, ['deleted'], wholeEntity(e));
  }
}

const setFields = (entity: object) =>
  Object.entries(entity)
    .filter(([k, v]) => k !== 'id' && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k]) => k);

/**
 * 実体の差分を1日分の書き込みにし、変更履歴(entity_changes)とともに書く。変更が無ければ何も書かず null。
 * expectedVersion を渡すと、その版のときだけ書く(違えば conflict)。
 */
export async function writeSheetDiff(
  r: TenantRepositories,
  ctx: SheetWriteContext,
  rows: AttendanceDayRows & { day: AttendanceDayRow },
  current: AttendanceSheetDay,
  next: AttendanceSheetDay,
  expectedVersion?: number,
): Promise<AttendanceDayRow | null> {
  const diff = diffAttendanceSheets(current, next);
  if (isEmptyDiff(diff)) return null;
  const date = rows.businessDate;
  const tenantId = r.tenantId;
  const existingVisit = new Map(rows.visits.map((v) => [v.id, v]));
  const existingSegment = new Map(rows.segments.map((s) => [s.id, s]));
  const encrypt = (purpose: (typeof P)[keyof typeof P], rowId: string, value: string) =>
    value ? ctx.crypto.encrypt({ tenantId, purpose, rowId }, value) : Promise.resolve(null);

  const visitRow = async (v: VisitEntity, before?: VisitEntity): Promise<VisitRow> => ({
    id: v.id,
    seq: v.seq,
    customerId: v.customerId,
    plannedPeriod: toRange(v.plannedStart, v.plannedEnd, date, ctx.timeZone),
    actualPeriod: toRange(v.start, v.end, date, ctx.timeZone),
    status: v.status,
    source: v.source,
    externalEventId: v.externalEventId,
    labelEnc:
      before && before.label === v.label
        ? (existingVisit.get(v.id)?.labelEnc ?? null)
        : await encrypt(P.visitLabel, v.id, v.label),
    overriddenFields: v.overriddenFields,
  });
  const segmentRow = async (s: WorkSegmentEntity, before?: WorkSegmentEntity): Promise<WorkSegmentRow> => ({
    id: s.id,
    seq: s.seq,
    period: toRange(s.start, s.end, date, ctx.timeZone),
    descriptionEnc:
      before && before.description === s.description
        ? (existingSegment.get(s.id)?.descriptionEnc ?? null)
        : await encrypt(P.workSegmentDescription, s.id, s.description),
    overriddenFields: s.overriddenFields,
  });
  const visitIdBySeq = new Map(next.visits.map((v) => [v.seq, v.id]));
  const slotVisits = next.visits.filter((v) => v.seq <= 3).sort((a, b) => a.seq - b.seq);
  const legRow = (l: TravelLegEntity): TravelLegRow => ({
    id: l.id,
    kind: l.kind,
    seq: l.seq,
    fromVisitId:
      l.kind === 'between'
        ? (visitIdBySeq.get(l.seq) ?? null)
        : l.kind === 'return'
          ? (slotVisits.at(-1)?.id ?? null)
          : null,
    toVisitId:
      l.kind === 'between'
        ? (visitIdBySeq.get(l.seq + 1) ?? null)
        : l.kind === 'commute'
          ? (slotVisits[0]?.id ?? null)
          : null,
    plannedMinutes: l.plannedMinutes,
    distanceKm: l.distanceKm === null ? null : l.distanceKm.toFixed(2),
    weather: l.weather,
    overriddenFields: l.overriddenFields,
  });

  const write: AttendanceDayWrite = {
    day: {
      shoppingErrandCount: next.day.shoppingErrandCount,
      remarksEnc:
        current.day.remarks === next.day.remarks
          ? rows.day.remarksEnc
          : await encrypt(P.attendanceRemarks, rows.day.id, next.day.remarks),
      overriddenFields: next.day.overriddenFields,
    },
    visits: {
      insert: await Promise.all(diff.visits.insert.map((v) => visitRow(v))),
      update: await Promise.all(diff.visits.update.map((u) => visitRow(u.after, u.before))),
      delete: diff.visits.delete.map((v) => v.id),
    },
    segments: {
      insert: await Promise.all(diff.segments.insert.map((s) => segmentRow(s))),
      update: await Promise.all(diff.segments.update.map((u) => segmentRow(u.after, u.before))),
      delete: diff.segments.delete.map((s) => s.id),
    },
    // 訪問の出入りで from / to が変わるため、残る移動は全て書き直す
    legs: {
      insert: diff.legs.insert.map(legRow),
      update: next.legs.filter((l) => !diff.legs.insert.includes(l)).map(legRow),
      delete: diff.legs.delete.map((l) => l.id),
    },
  };
  const saved = await r.attendance.writeDay(rows.day.id, write, expectedVersion);

  if (diff.day) {
    await appendChange(
      r,
      ctx,
      'attendance_day',
      rows.day.id,
      diff.day.changedFields,
      pickFields(diff.day.before, diff.day.changedFields),
    );
  }
  await recordHistory(r, ctx, 'visit', diff.visits, setFields);
  await recordHistory(r, ctx, 'work_segment', diff.segments, setFields);
  await recordHistory(r, ctx, 'travel_leg', diff.legs, setFields);
  return saved;
}

/**
 * 個別出勤簿スプレッドシートの該当日の行へのミラー(版ごとに1回)。書く列は今回の書き込みで表示の変わった列だけ
 * (columns。ペイロードに持つ)。値はワーカーが送るときに DB から読み直す。
 */
export function enqueueAttendanceDayMirror(
  r: TenantRepositories,
  day: AttendanceDayRow,
  columns: readonly AttendanceColumnKey[],
): Promise<void> {
  return r.outbox.enqueue({
    topic: 'mirror.attendance_day',
    aggregateType: 'attendance_day',
    aggregateId: day.id,
    dedupeKey: outboxDedupeKey('mirror.attendance_day', day.id, day.rowVersion),
    payload: { columns: [...columns] },
  });
}

/**
 * 「勤怠集計」スプレッドシートの該当スタッフ・該当日の行の書き直し。行の中身は GAS側がカレンダーから計算し直す
 * ため、予定の内容(fingerprint)がその日の最後に積んだものと同じなら積まない(force は管理者の明示の書き直し)。
 * 重複排除キーはその日の送信の通し番号(ペイロードの seq)で、予定が A → B → A と戻った場合も3回目を積む
 * (内容の指紋をキーにすると、戻った A が1回目と同じキーになり積まれなかった)。
 */
export async function enqueueAttendanceAggregateMirror(
  r: TenantRepositories,
  dayId: string,
  fingerprint: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const topic = 'mirror.attendance_aggregate';
  const last = await r.outbox.latestPayload(topic, dayId);
  if (!options.force && last?.fingerprint === fingerprint) return;
  const seq = (typeof last?.seq === 'number' ? last.seq : 0) + 1;
  await r.outbox.enqueue({
    topic,
    aggregateType: 'attendance_day',
    aggregateId: dayId,
    dedupeKey: outboxDedupeKey(topic, dayId, seq),
    payload: { fingerprint, seq },
  });
}
