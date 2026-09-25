import type { DailyReportRecord, DailyReportRepositoryPort, NewDailyReportInput } from '@katahimo/core/ports';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { dailyReports } from '../schema';

type DailyReportRow = typeof dailyReports.$inferSelect;

function toRecord(row: DailyReportRow): DailyReportRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    customerId: row.customerId,
    occurredAt: row.occurredAt,
    riskRating: row.riskRating,
    esRating: row.esRating,
    content: { ciphertext: row.contentCiphertext, keyVersion: row.contentKeyVersion },
  };
}

export class DrizzleDailyReportRepository implements DailyReportRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewDailyReportInput): Promise<DailyReportRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(dailyReports)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          customerId: input.customerId,
          occurredAt: input.occurredAt,
          riskRating: input.riskRating,
          esRating: input.esRating,
          contentCiphertext: input.content.ciphertext,
          contentKeyVersion: input.content.keyVersion,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('日報の保存に失敗しました');
      return toRecord(row);
    });
  }

  async update(tenantId: string, id: string, input: NewDailyReportInput): Promise<DailyReportRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(dailyReports)
        .set({
          occurredAt: input.occurredAt,
          riskRating: input.riskRating,
          esRating: input.esRating,
          contentCiphertext: input.content.ciphertext,
          contentKeyVersion: input.content.keyVersion,
          updatedAt: new Date(),
        })
        .where(eq(dailyReports.id, id))
        .returning();
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findById(tenantId: string, id: string): Promise<DailyReportRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(dailyReports).where(eq(dailyReports.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async listByCustomer(
    tenantId: string,
    customerId: string,
    before: Date | null,
    limit: number,
  ): Promise<DailyReportRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const condition = before
        ? and(eq(dailyReports.customerId, customerId), lt(dailyReports.occurredAt, before))
        : eq(dailyReports.customerId, customerId);
      const rows = await tx
        .select()
        .from(dailyReports)
        .where(condition)
        .orderBy(desc(dailyReports.occurredAt))
        .limit(limit);
      return rows.map(toRecord);
    });
  }
}
