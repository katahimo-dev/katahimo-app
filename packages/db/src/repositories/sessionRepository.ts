import type { NewSessionInput, SessionRecord, SessionRepositoryPort } from '@katahimo/core/ports';
import { and, eq, ne } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { sessions } from '../schema';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toRecord(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

export class DrizzleSessionRepository implements SessionRepositoryPort {
  constructor(private readonly db: Database) {}

  async create(input: NewSessionInput): Promise<SessionRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const rows = await tx.insert(sessions).values(input).returning();
      const row = rows[0];
      if (!row) throw new Error('セッションの作成に失敗しました');
      return toRecord(row);
    });
  }

  async findByTokenHash(tenantId: string, tokenHash: string): Promise<SessionRecord | null> {
    // Cookieのテナント部分は利用者が書き換えられるため、UUIDでなければ問い合わせずに無効とする
    // (RLSポリシーの::uuidキャストで例外になるのを避ける)。
    if (!UUID_PATTERN.test(tenantId)) return null;
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async updateExpiry(tenantId: string, sessionId: string, expiresAt: Date): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId)),
    );
  }

  async delete(tenantId: string, sessionId: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) => tx.delete(sessions).where(eq(sessions.id, sessionId)));
  }

  async deleteAllForStaff(tenantId: string, staffId: string, exceptSessionId?: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .delete(sessions)
        .where(
          exceptSessionId
            ? and(eq(sessions.staffId, staffId), ne(sessions.id, exceptSessionId))
            : eq(sessions.staffId, staffId),
        ),
    );
  }
}
