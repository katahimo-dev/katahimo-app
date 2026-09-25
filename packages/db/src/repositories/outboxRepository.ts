import type { MirrorJob, OutboxJobRecord, OutboxRepositoryPort } from '@katahimo/core/ports';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { outboxJobs } from '../schema';

type OutboxJobRow = typeof outboxJobs.$inferSelect;

function toRecord(row: OutboxJobRow): OutboxJobRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kind: row.kind as OutboxJobRecord['kind'],
    targetId: row.targetId,
    attempts: row.attempts,
  };
}

export class DrizzleOutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly db: Database) {}

  async enqueue(job: MirrorJob): Promise<void> {
    await withTenant(this.db, job.tenantId, async (tx) => {
      // 同じidempotencyKeyでの再enqueueは無視する(呼び出し側のリトライ等での二重積みを防ぐ)。
      await tx
        .insert(outboxJobs)
        .values({
          tenantId: job.tenantId,
          kind: job.kind,
          targetId: job.targetId,
          idempotencyKey: job.idempotencyKey,
        })
        .onConflictDoNothing({ target: [outboxJobs.tenantId, outboxJobs.idempotencyKey] });
    });
  }

  async claimPending(tenantId: string, limit: number): Promise<OutboxJobRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      // FOR UPDATE SKIP LOCKEDで、複数ワーカーインスタンスが同時にポーリングしても
      // 同じジョブを二重に取得しないようにする。
      const pending = await tx
        .select({ id: outboxJobs.id })
        .from(outboxJobs)
        .where(eq(outboxJobs.status, 'pending'))
        .orderBy(asc(outboxJobs.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      if (pending.length === 0) return [];

      const ids = pending.map((p) => p.id);
      const rows = await tx
        .update(outboxJobs)
        .set({ status: 'processing', attempts: sql`${outboxJobs.attempts} + 1` })
        .where(inArray(outboxJobs.id, ids))
        .returning();
      return rows.map(toRecord);
    });
  }

  async markDone(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(outboxJobs)
        .set({ status: 'done', processedAt: new Date() })
        .where(eq(outboxJobs.id, id));
    });
  }

  async markFailed(tenantId: string, id: string, error: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(outboxJobs)
        .set({ status: 'failed', lastError: error, processedAt: new Date() })
        .where(eq(outboxJobs.id, id));
    });
  }
}
