import type { MirrorJob, OutboxJobRecord, OutboxRepositoryPort } from '@katahimo/core/ports';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { withTenant } from '../client';
import { outboxJobs } from '../schema';

type OutboxJobRow = typeof outboxJobs.$inferSelect;

/**
 * processing のまま更新が止まったジョブを取り直すまでの時間。ワーカーが処理中に落ちた場合でも、
 * この時間が過ぎれば別のワーカー(次回のポーリング)が再取得する。1件の送信(GAS Bridge呼び出し)に
 * 掛かる時間より十分長くしておく。
 */
const PROCESSING_LEASE = sql`interval '10 minutes'`;

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
      const claimable = await tx
        .select({ id: outboxJobs.id })
        .from(outboxJobs)
        .where(
          or(
            and(eq(outboxJobs.status, 'pending'), lte(outboxJobs.nextAttemptAt, sql`now()`)),
            and(
              eq(outboxJobs.status, 'processing'),
              lte(outboxJobs.updatedAt, sql`now() - ${PROCESSING_LEASE}`),
            ),
          ),
        )
        .orderBy(asc(outboxJobs.nextAttemptAt), asc(outboxJobs.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true });
      if (claimable.length === 0) return [];

      const rows = await tx
        .update(outboxJobs)
        .set({ status: 'processing', attempts: sql`${outboxJobs.attempts} + 1`, updatedAt: sql`now()` })
        .where(
          inArray(
            outboxJobs.id,
            claimable.map((p) => p.id),
          ),
        )
        .returning();
      return rows.map(toRecord);
    });
  }

  async markDone(tenantId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(outboxJobs)
        .set({ status: 'done', lastError: null, processedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(outboxJobs.id, id));
    });
  }

  async scheduleRetry(tenantId: string, id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(outboxJobs)
        .set({ status: 'pending', lastError: error, nextAttemptAt, updatedAt: sql`now()` })
        .where(eq(outboxJobs.id, id));
    });
  }

  async markFailed(tenantId: string, id: string, error: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(outboxJobs)
        .set({ status: 'failed', lastError: error, processedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(outboxJobs.id, id));
    });
  }
}
