import type {
  NewPasswordResetCodeInput,
  PasswordResetCodeRecord,
  PasswordResetCodeRepositoryPort,
} from '@katahimo/core/ports';
import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { passwordResetCodes } from '../schema';

export class DrizzlePasswordResetCodeRepository implements PasswordResetCodeRepositoryPort {
  constructor(private readonly db: Database) {}

  async replaceActive(input: NewPasswordResetCodeInput, now: Date): Promise<PasswordResetCodeRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      await tx
        .update(passwordResetCodes)
        .set({ usedAt: now })
        .where(and(eq(passwordResetCodes.staffId, input.staffId), isNull(passwordResetCodes.usedAt)));
      const rows = await tx
        .insert(passwordResetCodes)
        .values({ ...input, createdAt: now })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('パスワード再設定コードの保存に失敗しました');
      return row;
    });
  }

  async findLatestUnused(tenantId: string, staffId: string): Promise<PasswordResetCodeRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(passwordResetCodes)
        .where(and(eq(passwordResetCodes.staffId, staffId), isNull(passwordResetCodes.usedAt)))
        .orderBy(desc(passwordResetCodes.createdAt))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async countIssuedSince(tenantId: string, staffId: string, since: Date): Promise<number> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ value: count() })
        .from(passwordResetCodes)
        .where(and(eq(passwordResetCodes.staffId, staffId), gte(passwordResetCodes.createdAt, since)));
      return rows[0]?.value ?? 0;
    });
  }

  async incrementAttempts(tenantId: string, id: string): Promise<number> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(passwordResetCodes)
        .set({ attemptCount: sql`${passwordResetCodes.attemptCount} + 1` })
        .where(eq(passwordResetCodes.id, id))
        .returning({ attemptCount: passwordResetCodes.attemptCount });
      return rows[0]?.attemptCount ?? 0;
    });
  }

  async markUsed(tenantId: string, id: string, usedAt: Date): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx.update(passwordResetCodes).set({ usedAt }).where(eq(passwordResetCodes.id, id)),
    );
  }
}
