import type {
  ActiveStaffRecord,
  NewStaffInput,
  StaffPatch,
  StaffRecord,
  StaffRepositoryPort,
} from '@katahimo/core/ports';
import { eq, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { staff } from '../schema';

function toRecord(row: typeof staff.$inferSelect): StaffRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    email: row.email,
    altEmail: row.altEmail,
    phone: row.phone,
    passwordHash: row.passwordHash,
    legacyPasswordHash: row.legacyPasswordHash,
    isAdmin: row.isAdmin,
    retirementDate: row.retirementDate,
  };
}

/** 退職日がJSTの今日より後(または未設定)。DBセッションのTimeZoneに依存しないよう明示的にJSTで比較する。 */
const notRetiredCondition = or(
  isNull(staff.retirementDate),
  sql`${staff.retirementDate} > (now() at time zone 'Asia/Tokyo')::date`,
);

export class DrizzleStaffRepository implements StaffRepositoryPort {
  constructor(private readonly db: Database) {}

  async findByLoginEmail(tenantId: string, email: string): Promise<StaffRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(staff)
        .where(or(eq(staff.email, email), eq(staff.altEmail, email)))
        // email列での一致を優先する(両列の重複はusecase側で防いでいるが、念のため順序を固定する)。
        .orderBy(sql`case when ${staff.email} = ${email} then 0 else 1 end`)
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findById(tenantId: string, staffId: string): Promise<StaffRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(staff).where(eq(staff.id, staffId)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async create(input: NewStaffInput): Promise<StaffRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(staff)
        .values({
          tenantId: input.tenantId,
          name: input.name,
          email: input.email,
          altEmail: input.altEmail ?? null,
          phone: input.phone ?? null,
          passwordHash: input.passwordHash ?? null,
          legacyPasswordHash: input.legacyPasswordHash ?? null,
          isAdmin: input.isAdmin,
          retirementDate: input.retirementDate ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('スタッフの作成に失敗しました');
      return toRecord(row);
    });
  }

  async update(tenantId: string, staffId: string, patch: StaffPatch): Promise<StaffRecord | null> {
    const values = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(staff)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(staff.id, staffId))
        .returning();
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async updatePasswordHash(tenantId: string, staffId: string, passwordHash: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(staff)
        .set({ passwordHash, legacyPasswordHash: null, updatedAt: new Date() })
        .where(eq(staff.id, staffId));
    });
  }

  async listAll(tenantId: string): Promise<StaffRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => (await tx.select().from(staff)).map(toRecord));
  }

  async listActive(tenantId: string): Promise<ActiveStaffRecord[]> {
    return withTenant(this.db, tenantId, async (tx) =>
      tx.select({ id: staff.id, name: staff.name }).from(staff).where(notRetiredCondition),
    );
  }
}
