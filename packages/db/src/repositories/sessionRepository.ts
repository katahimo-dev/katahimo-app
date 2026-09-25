import type { NewSessionInput, SessionRecord, SessionRepositoryPort } from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { sessions } from '../schema';

export class DrizzleSessionRepository implements SessionRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewSessionInput): Promise<SessionRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx
        .insert(sessions)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('セッションの作成に失敗しました');
      return { id: row.id, tenantId: row.tenantId, staffId: row.staffId, expiresAt: row.expiresAt };
    });
  }

  async findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
      const row = rows[0];
      if (!row) return null;
      return { id: row.id, tenantId: row.tenantId, staffId: row.staffId, expiresAt: row.expiresAt };
    });
  }
}
