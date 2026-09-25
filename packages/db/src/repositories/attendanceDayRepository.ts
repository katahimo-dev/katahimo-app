import type {
  AttendanceDayRecord,
  AttendanceDayRepositoryPort,
  EncryptedField,
  SaveAttendanceDayInput,
} from '@katahimo/core/ports';
import { and, eq, gte, lt, lte } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { attendanceDayChanges, attendanceDays } from '../schema';

type AttendanceDayRow = typeof attendanceDays.$inferSelect;

function toRecord(row: AttendanceDayRow): AttendanceDayRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    businessDate: row.businessDate,
    rowData: { ciphertext: row.rowDataCiphertext, keyVersion: row.rowDataKeyVersion },
    changedFields: row.changedFields,
    lastChangedByStaffId: row.lastChangedByStaffId,
  };
}

/** 'YYYY-MM' から、その月の [1日, 翌月1日) を返す。 */
function monthRange(yearMonth: string): { start: string; nextMonthStart: string } {
  const [year, month] = yearMonth.split('-').map(Number) as [number, number];
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: `${yearMonth}-01`,
    nextMonthStart: `${next.year}-${String(next.month).padStart(2, '0')}-01`,
  };
}

export class DrizzleAttendanceDayRepository implements AttendanceDayRepositoryPort {
  constructor(private readonly db: Database) {}

  async findByStaffAndDate(
    tenantId: string,
    staffId: string,
    businessDate: string,
  ): Promise<AttendanceDayRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.staffId, staffId), eq(attendanceDays.businessDate, businessDate)))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findById(tenantId: string, id: string): Promise<AttendanceDayRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(attendanceDays).where(eq(attendanceDays.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async save(input: SaveAttendanceDayInput): Promise<AttendanceDayRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const values = {
        rowDataCiphertext: input.rowData.ciphertext,
        rowDataKeyVersion: input.rowData.keyVersion,
        changedFields: input.changedFields,
        lastChangedByStaffId: input.lastChangedByStaffId,
      };
      const rows = await tx
        .insert(attendanceDays)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          businessDate: input.businessDate,
          ...values,
        })
        .onConflictDoUpdate({
          target: [attendanceDays.tenantId, attendanceDays.staffId, attendanceDays.businessDate],
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('勤怠データの保存に失敗しました');

      await tx.insert(attendanceDayChanges).values({
        tenantId: input.tenantId,
        attendanceDayId: row.id,
        changedByStaffId: input.history.changedByStaffId,
        changedFields: input.history.changedFields,
        previousRowDataCiphertext: input.history.previousRowData?.ciphertext ?? null,
        previousRowDataKeyVersion: input.history.previousRowData?.keyVersion ?? null,
      });
      return toRecord(row);
    });
  }

  async findOrCreate(
    tenantId: string,
    staffId: string,
    businessDate: string,
    emptyRowData: EncryptedField,
  ): Promise<AttendanceDayRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      await tx
        .insert(attendanceDays)
        .values({
          tenantId,
          staffId,
          businessDate,
          rowDataCiphertext: emptyRowData.ciphertext,
          rowDataKeyVersion: emptyRowData.keyVersion,
        })
        .onConflictDoNothing({
          target: [attendanceDays.tenantId, attendanceDays.staffId, attendanceDays.businessDate],
        });
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.staffId, staffId), eq(attendanceDays.businessDate, businessDate)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error('勤怠データの作成に失敗しました');
      return toRecord(row);
    });
  }

  async listByStaffAndMonth(
    tenantId: string,
    staffId: string,
    yearMonth: string,
  ): Promise<AttendanceDayRecord[]> {
    const { start, nextMonthStart } = monthRange(yearMonth);
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.staffId, staffId),
            gte(attendanceDays.businessDate, start),
            lt(attendanceDays.businessDate, nextMonthStart),
          ),
        );
      return rows.map(toRecord);
    });
  }

  async listByStaffAndDateRange(
    tenantId: string,
    staffId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.staffId, staffId),
            gte(attendanceDays.businessDate, startDate),
            lte(attendanceDays.businessDate, endDate),
          ),
        );
      return rows.map(toRecord);
    });
  }
}
