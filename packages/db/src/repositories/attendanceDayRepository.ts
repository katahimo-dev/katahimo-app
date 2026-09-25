import type { AttendanceDayRecord, AttendanceDayRepositoryPort, EncryptedField } from '@katahimo/core/ports';
import { and, eq, gte, lt, lte } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { attendanceDays } from '../schema';

type AttendanceDayRow = typeof attendanceDays.$inferSelect;

function toRecord(row: AttendanceDayRow): AttendanceDayRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    businessDate: row.businessDate,
    rowData: { ciphertext: row.rowDataCiphertext, keyVersion: row.rowDataKeyVersion },
  };
}

/** 'YYYY-MM' から、その月の [開始日, 翌月開始日) の範囲を返す(月末日数を気にせず済むように)。 */
function monthRange(yearMonth: string): { start: string; nextMonthStart: string } {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = `${yearMonth}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, nextMonthStart };
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

  async upsert(
    tenantId: string,
    staffId: string,
    businessDate: string,
    rowData: EncryptedField,
  ): Promise<AttendanceDayRecord> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .insert(attendanceDays)
        .values({
          tenantId,
          staffId,
          businessDate,
          rowDataCiphertext: rowData.ciphertext,
          rowDataKeyVersion: rowData.keyVersion,
        })
        .onConflictDoUpdate({
          target: [attendanceDays.tenantId, attendanceDays.staffId, attendanceDays.businessDate],
          set: {
            rowDataCiphertext: rowData.ciphertext,
            rowDataKeyVersion: rowData.keyVersion,
            updatedAt: new Date(),
          },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('勤怠データの保存に失敗しました');
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
