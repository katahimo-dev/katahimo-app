import type {
  NewPasswordResetCodeInput,
  NewSessionInput,
  PasswordResetCodeRecord,
  PasswordResetCodeRepository,
  SessionRecord,
  SessionRepository,
} from '@katahimo/core/ports';
import { and, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { passwordResetCodes, sessions } from '../../schema';
import { TenantBound } from './base';

const sessionColumns = {
  id: sessions.id,
  staffId: sessions.staffId,
  createdAt: sessions.createdAt,
  lastSeenAt: sessions.lastSeenAt,
  idleExpiresAt: sessions.idleExpiresAt,
  absoluteExpiresAt: sessions.absoluteExpiresAt,
  revokedAt: sessions.revokedAt,
};

export class DrizzleSessionRepository extends TenantBound implements SessionRepository {
  async create(input: NewSessionInput): Promise<void> {
    await this.tx.insert(sessions).values({
      tenantId: this.tenantId,
      id: input.id,
      staffId: input.staffId,
      tokenHash: input.tokenHash,
      createdAt: input.createdAt,
      lastSeenAt: input.createdAt,
      idleExpiresAt: input.idleExpiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  async findByTokenHash(tokenHash: Uint8Array): Promise<SessionRecord | null> {
    const rows = await this.tx
      .select(sessionColumns)
      .from(sessions)
      .where(and(eq(sessions.tenantId, this.tenantId), eq(sessions.tokenHash, tokenHash)));
    return rows[0] ?? null;
  }

  async touch(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    await this.tx
      .update(sessions)
      .set({ lastSeenAt, idleExpiresAt })
      .where(and(eq(sessions.tenantId, this.tenantId), eq(sessions.id, id)));
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.tx
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.tenantId, this.tenantId), eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async revokeAllForStaff(staffId: string, at: Date, exceptId?: string): Promise<void> {
    await this.tx
      .update(sessions)
      .set({ revokedAt: at })
      .where(
        and(
          eq(sessions.tenantId, this.tenantId),
          eq(sessions.staffId, staffId),
          isNull(sessions.revokedAt),
          exceptId ? ne(sessions.id, exceptId) : undefined,
        ),
      );
  }
}

type CodeRow = typeof passwordResetCodes.$inferSelect;

function toCode(row: CodeRow): PasswordResetCodeRecord {
  return {
    id: row.id,
    staffId: row.staffId,
    codeHash: row.codeHash,
    sentToEmail: row.sentToEmail,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    attemptCount: row.attemptCount,
    maxAttempts: row.maxAttempts,
    mailCode: row.mailCode,
  };
}

/**
 * パスワード再設定コード。試行回数の加算・使用済みへの遷移は1文の条件付き UPDATE で行い、並列の要求でも
 * 上限を超えない・同じコードで2回再設定できない(2026-09 のセキュリティレビューで確かめた性質を保つ)。
 */
export class DrizzlePasswordResetCodeRepository extends TenantBound implements PasswordResetCodeRepository {
  private byId(id: string) {
    return and(eq(passwordResetCodes.tenantId, this.tenantId), eq(passwordResetCodes.id, id));
  }

  async replaceActive(input: NewPasswordResetCodeInput, now: Date): Promise<PasswordResetCodeRecord> {
    await this.tx
      .update(passwordResetCodes)
      .set({ usedAt: now, mailCode: null })
      .where(
        and(
          eq(passwordResetCodes.tenantId, this.tenantId),
          eq(passwordResetCodes.staffId, input.staffId),
          isNull(passwordResetCodes.usedAt),
        ),
      );
    const [row] = await this.tx
      .insert(passwordResetCodes)
      .values({ tenantId: this.tenantId, ...input, createdAt: now })
      .returning();
    return toCode(row as CodeRow);
  }

  async findLatestUnused(staffId: string): Promise<PasswordResetCodeRecord | null> {
    const rows = await this.tx
      .select()
      .from(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.tenantId, this.tenantId),
          eq(passwordResetCodes.staffId, staffId),
          isNull(passwordResetCodes.usedAt),
        ),
      )
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);
    return rows[0] ? toCode(rows[0]) : null;
  }

  async findById(id: string): Promise<PasswordResetCodeRecord | null> {
    const rows = await this.tx.select().from(passwordResetCodes).where(this.byId(id));
    return rows[0] ? toCode(rows[0]) : null;
  }

  async registerAttempt(id: string, now: Date): Promise<PasswordResetCodeRecord | null> {
    const rows = await this.tx
      .update(passwordResetCodes)
      .set({ attemptCount: sql`${passwordResetCodes.attemptCount} + 1` })
      .where(
        and(
          this.byId(id),
          isNull(passwordResetCodes.usedAt),
          gt(passwordResetCodes.expiresAt, now),
          lt(passwordResetCodes.attemptCount, passwordResetCodes.maxAttempts),
        ),
      )
      .returning();
    return rows[0] ? toCode(rows[0]) : null;
  }

  async consume(id: string, now: Date): Promise<boolean> {
    const rows = await this.tx
      .update(passwordResetCodes)
      .set({ usedAt: now, mailCode: null })
      .where(and(this.byId(id), isNull(passwordResetCodes.usedAt)))
      .returning({ id: passwordResetCodes.id });
    return rows.length > 0;
  }

  async markUsed(id: string, at: Date): Promise<void> {
    await this.tx
      .update(passwordResetCodes)
      .set({ usedAt: at, mailCode: null })
      .where(and(this.byId(id), isNull(passwordResetCodes.usedAt)));
  }

  async clearMailCode(id: string): Promise<void> {
    await this.tx.update(passwordResetCodes).set({ mailCode: null }).where(this.byId(id));
  }
}
