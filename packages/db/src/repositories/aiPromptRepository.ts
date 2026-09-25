import type { AiPromptRecord, AiPromptRepositoryPort, UpsertAiPromptInput } from '@katahimo/core/ports';
import { eq } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { aiPrompts } from '../schema';

function toRecord(row: typeof aiPrompts.$inferSelect): AiPromptRecord {
  return {
    tenantId: row.tenantId,
    kind: row.kind,
    key: row.key,
    body: row.body,
    updatedByStaffId: row.updatedByStaffId,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleAiPromptRepository implements AiPromptRepositoryPort {
  constructor(private readonly db: Database) {}

  async listAll(tenantId: string): Promise<AiPromptRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => (await tx.select().from(aiPrompts)).map(toRecord));
  }

  async findByKey(tenantId: string, key: string): Promise<AiPromptRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(aiPrompts).where(eq(aiPrompts.key, key)).limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    });
  }

  async upsert(input: UpsertAiPromptInput): Promise<AiPromptRecord> {
    return withTenant(this.db, input.tenantId, async (tx) => {
      const now = new Date();
      const rows = await tx
        .insert(aiPrompts)
        .values({ ...input, updatedAt: now })
        .onConflictDoUpdate({
          target: [aiPrompts.tenantId, aiPrompts.key],
          set: {
            kind: input.kind,
            body: input.body,
            updatedByStaffId: input.updatedByStaffId,
            updatedAt: now,
          },
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('AIプロンプトの保存に失敗しました');
      return toRecord(row);
    });
  }

  async delete(tenantId: string, key: string): Promise<void> {
    await withTenant(this.db, tenantId, (tx) => tx.delete(aiPrompts).where(eq(aiPrompts.key, key)));
  }
}
