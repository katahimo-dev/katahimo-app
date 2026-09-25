import { conflict, STALE_WRITE_MESSAGE } from '@katahimo/core/domain';
import type {
  AttendanceDayRow,
  AttendanceDayRows,
  AttendanceDayWrite,
  AttendanceRepository,
  TravelLegRow,
  VisitRow,
  WorkSegmentRow,
} from '@katahimo/core/ports';
import { and, asc, between, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { attendanceDays, attendancePeriods, travelLegs, visits, workSegments } from '../../schema';
import { TenantBound } from './base';

const dayColumns = {
  id: attendanceDays.id,
  staffId: attendanceDays.staffId,
  businessDate: attendanceDays.businessDate,
  shoppingErrandCount: attendanceDays.shoppingErrandCount,
  remarksEnc: attendanceDays.remarksEnc,
  overriddenFields: attendanceDays.overriddenFields,
  rowVersion: attendanceDays.rowVersion,
};

const visitColumns = {
  id: visits.id,
  businessDate: visits.businessDate,
  seq: visits.seq,
  customerId: visits.customerId,
  plannedPeriod: visits.plannedPeriod,
  actualPeriod: visits.actualPeriod,
  status: visits.status,
  source: visits.source,
  externalEventId: visits.externalEventId,
  labelEnc: visits.labelEnc,
  overriddenFields: visits.overriddenFields,
};

const segmentColumns = {
  id: workSegments.id,
  businessDate: workSegments.businessDate,
  seq: workSegments.seq,
  period: workSegments.period,
  descriptionEnc: workSegments.descriptionEnc,
  overriddenFields: workSegments.overriddenFields,
};

const legColumns = {
  id: travelLegs.id,
  businessDate: travelLegs.businessDate,
  kind: travelLegs.kind,
  seq: travelLegs.seq,
  fromVisitId: travelLegs.fromVisitId,
  toVisitId: travelLegs.toVisitId,
  plannedMinutes: travelLegs.plannedMinutes,
  distanceKm: travelLegs.distanceKm,
  weather: travelLegs.weather,
  overriddenFields: travelLegs.overriddenFields,
};

function strip<T extends { businessDate: string }>(row: T): Omit<T, 'businessDate'> {
  const { businessDate: _date, ...rest } = row;
  return rest;
}

/**
 * 勤怠(1日の入れ物 attendance_days と visits / work_segments / travel_legs)。1日単位で読み書きする。
 * 書き込みは UoW のトランザクションの中で、lockDay で入れ物の行を押さえてから行う。
 */
export class DrizzleAttendanceRepository extends TenantBound implements AttendanceRepository {
  private async loadDates(staffId: string, fromDate: string, toDate: string): Promise<AttendanceDayRows[]> {
    const staffOn = <T extends typeof visits | typeof workSegments | typeof travelLegs>(table: T) =>
      and(
        eq(table.tenantId, this.tenantId),
        eq(table.staffId, staffId),
        between(table.businessDate, fromDate, toDate),
      );
    const [days, visitRows, segmentRows, legRows] = await Promise.all([
      this.tx
        .select(dayColumns)
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.tenantId, this.tenantId),
            eq(attendanceDays.staffId, staffId),
            between(attendanceDays.businessDate, fromDate, toDate),
          ),
        ),
      this.tx.select(visitColumns).from(visits).where(staffOn(visits)).orderBy(asc(visits.seq)),
      this.tx
        .select(segmentColumns)
        .from(workSegments)
        .where(staffOn(workSegments))
        .orderBy(asc(workSegments.seq)),
      this.tx
        .select(legColumns)
        .from(travelLegs)
        .where(staffOn(travelLegs))
        .orderBy(asc(travelLegs.kind), asc(travelLegs.seq)),
    ]);
    const byDate = new Map<string, AttendanceDayRows>();
    const entry = (date: string) => {
      let value = byDate.get(date);
      if (!value) {
        value = { staffId, businessDate: date, day: null, visits: [], segments: [], legs: [] };
        byDate.set(date, value);
      }
      return value;
    };
    for (const day of days) entry(day.businessDate).day = day;
    for (const v of visitRows) entry(v.businessDate).visits.push(strip(v) as VisitRow);
    for (const s of segmentRows) entry(s.businessDate).segments.push(strip(s));
    for (const l of legRows) entry(l.businessDate).legs.push(strip(l) as TravelLegRow);
    return [...byDate.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  }

  async loadDay(staffId: string, businessDate: string): Promise<AttendanceDayRows> {
    const [rows] = await this.loadDates(staffId, businessDate, businessDate);
    return rows ?? { staffId, businessDate, day: null, visits: [], segments: [], legs: [] };
  }

  async lockDay(
    staffId: string,
    businessDate: string,
    newDayId: string,
  ): Promise<AttendanceDayRows & { day: AttendanceDayRow; existed: boolean }> {
    const created = await this.tx
      .insert(attendanceDays)
      .values({ tenantId: this.tenantId, id: newDayId, staffId, businessDate })
      .onConflictDoNothing({
        target: [attendanceDays.tenantId, attendanceDays.staffId, attendanceDays.businessDate],
      })
      .returning({ id: attendanceDays.id });
    await this.tx
      .select({ id: attendanceDays.id })
      .from(attendanceDays)
      .where(
        and(
          eq(attendanceDays.tenantId, this.tenantId),
          eq(attendanceDays.staffId, staffId),
          eq(attendanceDays.businessDate, businessDate),
        ),
      )
      .for('update');
    const rows = (await this.loadDay(staffId, businessDate)) as AttendanceDayRows & { day: AttendanceDayRow };
    return { ...rows, existed: created.length === 0 };
  }

  loadRange(staffId: string, fromDate: string, toDate: string): Promise<AttendanceDayRows[]> {
    return this.loadDates(staffId, fromDate, toDate);
  }

  async findDayById(dayId: string): Promise<AttendanceDayRows | null> {
    const [day] = await this.tx
      .select(dayColumns)
      .from(attendanceDays)
      .where(and(eq(attendanceDays.tenantId, this.tenantId), eq(attendanceDays.id, dayId)));
    if (!day) return null;
    return this.loadDay(day.staffId, day.businessDate);
  }

  async writeDay(
    dayId: string,
    write: AttendanceDayWrite,
    expectedVersion?: number,
  ): Promise<AttendanceDayRow> {
    const [day] = await this.tx
      .update(attendanceDays)
      .set({ ...write.day, rowVersion: sql`${attendanceDays.rowVersion} + 1` })
      .where(
        and(
          eq(attendanceDays.tenantId, this.tenantId),
          eq(attendanceDays.id, dayId),
          expectedVersion === undefined ? undefined : eq(attendanceDays.rowVersion, expectedVersion),
        ),
      )
      .returning(dayColumns);
    if (!day) throw conflict(STALE_WRITE_MESSAGE, undefined, 'stale_row_version');
    const own = { tenantId: this.tenantId, staffId: day.staffId, businessDate: day.businessDate };

    const byIds = <T extends typeof visits | typeof workSegments | typeof travelLegs>(
      table: T,
      ids: string[],
    ) => and(eq(table.tenantId, this.tenantId), inArray(table.id, ids));
    if (write.legs.delete.length > 0)
      await this.tx.delete(travelLegs).where(byIds(travelLegs, write.legs.delete));
    if (write.segments.delete.length > 0) {
      await this.tx.delete(workSegments).where(byIds(workSegments, write.segments.delete));
    }
    if (write.visits.delete.length > 0)
      await this.tx.delete(visits).where(byIds(visits, write.visits.delete));

    // 外部の予定IDを別の訪問へ付け替える場合に一意制約がぶつからないよう、先に外してから付け直す
    const reassigned = write.visits.update.map((v) => v.id);
    if (reassigned.length > 0) {
      await this.tx
        .update(visits)
        .set({ externalEventId: null })
        .where(and(byIds(visits, reassigned), isNotNull(visits.externalEventId)));
    }
    // 移動は訪問を参照するため、訪問の追加・更新の後に書く
    if (write.visits.insert.length > 0) {
      await this.tx.insert(visits).values(write.visits.insert.map((v: VisitRow) => ({ ...own, ...v })));
    }
    for (const visit of write.visits.update) {
      const { id, ...values } = visit;
      await this.tx
        .update(visits)
        .set(values)
        .where(byIds(visits, [id]));
    }
    if (write.segments.insert.length > 0) {
      await this.tx
        .insert(workSegments)
        .values(write.segments.insert.map((s: WorkSegmentRow) => ({ ...own, ...s })));
    }
    for (const segment of write.segments.update) {
      const { id, ...values } = segment;
      await this.tx
        .update(workSegments)
        .set(values)
        .where(byIds(workSegments, [id]));
    }
    if (write.legs.insert.length > 0) {
      await this.tx.insert(travelLegs).values(write.legs.insert.map((l: TravelLegRow) => ({ ...own, ...l })));
    }
    for (const leg of write.legs.update) {
      const { id, ...values } = leg;
      await this.tx
        .update(travelLegs)
        .set(values)
        .where(byIds(travelLegs, [id]));
    }
    return day;
  }

  async lockPeriod(staffId: string, yearMonth: string, lockedBy: string, at: Date): Promise<void> {
    await this.tx
      .insert(attendancePeriods)
      .values({ tenantId: this.tenantId, staffId, yearMonth, status: 'locked', lockedAt: at, lockedBy })
      .onConflictDoUpdate({
        target: [attendancePeriods.tenantId, attendancePeriods.staffId, attendancePeriods.yearMonth],
        set: { status: 'locked', lockedAt: at, lockedBy },
      });
  }
}
