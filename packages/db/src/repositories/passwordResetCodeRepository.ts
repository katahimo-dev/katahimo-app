import type {
  NewPasswordResetCodeInput,
  PasswordResetCodeRecord,
  PasswordResetCodeRepositoryPort,
} from '@katahimo/core/ports';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { passwordResetCodes } from '../schema';

type Row = typeof passwordResetCodes.$inferSelect;

function toRecord(row: Row): PasswordResetCodeRecord {
  const { mailCodeCiphertext, mailCodeKeyVersion, ...rest } = row;
  return {
    ...rest,
    mailCode:
      mailCodeCiphertext && mailCodeKeyVersion != null
        ? { ciphertext: mailCodeCiphertext, keyVersion: mailCodeKeyVersion }
        : null,
  };
}

export class DrizzlePasswordResetCodeRepository implements PasswordResetCodeRepositoryPort {
  constructor(private readonly db: Database) {}

  async replaceActive(input: NewPasswordResetCodeInput, now: Date): Promise<PasswordResetCodeRecord> {
    const { mailCode, ...fields } = input;
    return withTenant(this.db, input.tenantId, async (tx) => {
      await tx
        .update(passwordResetCodes)
        .set({ usedAt: now, mailCodeCiphertext: null, mailCodeKeyVersion: null })
        .where(and(eq(passwordResetCodes.staffId, input.staffId), isNull(passwordResetCodes.usedAt)));
      const rows = await tx
        .insert(passwordResetCodes)
        .values({
          ...fields,
          mailCodeCiphertext: mailCode.ciphertext,
          mailCodeKeyVersion: mailCode.keyVersion,
          createdAt: now,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('パスワード再設定コードの保存に失敗しました');
      return toRecord(row);
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
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  async findById(tenantId: string, id: string): Promise<PasswordResetCodeRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(passwordResetCodes).where(eq(passwordResetCodes.id, id)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  /**
   * 判定と加算を1文の UPDATE ... WHERE ... RETURNING で行う。同時に来た要求は行ロックで順番に評価され、
   * attempt_count < maxAttempts の条件で上限を超えた分は0行になる(読んでから書く方式だと並列要求が
   * 同じ回数を読んで上限を超えて試せてしまう)。
   */
  async registerAttempt(
    tenantId: string,
    id: string,
    maxAttempts: number,
    now: Date,
  ): Promise<PasswordResetCodeRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(passwordResetCodes)
        .set({ attemptCount: sql`${passwordResetCodes.attemptCount} + 1` })
        .where(
          and(
            eq(passwordResetCodes.id, id),
            isNull(passwordResetCodes.usedAt),
            lt(passwordResetCodes.attemptCount, maxAttempts),
            gt(passwordResetCodes.expiresAt, now),
          ),
        )
        .returning();
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  /** used_at IS NULL を条件にした UPDATE。同じコードでの同時の再設定は1件だけが1行を得る。 */
  async consume(tenantId: string, id: string, now: Date): Promise<boolean> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .update(passwordResetCodes)
        .set({ usedAt: now, mailCodeCiphertext: null, mailCodeKeyVersion: null })
        .where(and(eq(passwordResetCodes.id, id), isNull(passwordResetCodes.usedAt)))
        .returning({ id: passwordResetCodes.id });
      return rows.length === 1;
    });
  }

  async markUsed(tenantId: string, id: string, usedAt: Date): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(passwordResetCodes)
        .set({
          usedAt: sql`coalesce(${passwordResetCodes.usedAt}, ${usedAt.toISOString()}::timestamptz)`,
          mailCodeCiphertext: null,
          mailCodeKeyVersion: null,
        })
        .where(eq(passwordResetCodes.id, id)),
    );
  }

  async clearMailCode(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .update(passwordResetCodes)
        .set({ mailCodeCiphertext: null, mailCodeKeyVersion: null })
        .where(eq(passwordResetCodes.id, id)),
    );
  }
}
