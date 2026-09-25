import type {
  AccidentReportRecord,
  AccidentReportRepositoryPort,
  NewAccidentReportInput,
} from '@katahimo/core/ports';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { accidentReports } from '../schema';

type AccidentReportRow = typeof accidentReports.$inferSelect;

function toRecord(row: AccidentReportRow): AccidentReportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    occurredAt: row.occurredAt,
    reportType: row.reportType,
    content: { ciphertext: row.contentCiphertext, keyVersion: row.contentKeyVersion },
  };
}

export class DrizzleAccidentReportRepository implements AccidentReportRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewAccidentReportInput): Promise<AccidentReportRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(accidentReports)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          customerId: input.customerId,
          occurredAt: input.occurredAt,
          reportType: input.reportType,
          contentCiphertext: input.content.ciphertext,
          contentKeyVersion: input.content.keyVersion,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('事故報告の保存に失敗しました');
      return toRecord(row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    input: NewAccidentReportInput,
  ): Promise<AccidentReportRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(accidentReports)
        .set({
          occurredAt: input.occurredAt,
          reportType: input.reportType,
          contentCiphertext: input.content.ciphertext,
          contentKeyVersion: input.content.keyVersion,
          updatedAt: new Date(),
        })
        .where(eq(accidentReports.id, id))
        .returning();
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findById(tenantId: string, id: string): Promise<AccidentReportRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(accidentReports).where(eq(accidentReports.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<AccidentReportRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const condition = before
        ? and(eq(accidentReports.customerId, customerId), lt(accidentReports.occurredAt, before))
        : eq(accidentReports.customerId, customerId);
      const rows = await tx
        .select()
        .from(accidentReports)
        .where(condition)
        .orderBy(desc(accidentReports.occurredAt))
        .limit(limit);
      return rows.map(toRecord);
    });
  }
}
