import type { OutboxTopic } from '@katahimo/core/domain';
import type { ClaimedOutboxMessage, ExpiredOutboxMessage, OutboxQueuePort } from '@katahimo/core/ports';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { Database } from '../../client';
import { outboxMessages } from '../../schema';

/**
 * ワーカー側の outbox。katahimo_worker で接続し、テナントを横断して取る(outbox_messages_worker ポリシー)。
 * 取り出しは1件ずつ: 取れるもの(pending で available_at を過ぎた・processing でリースが切れた)を
 * FOR UPDATE SKIP LOCKED で1行押さえ、processing・locked_until = now + リースにしてすぐコミットする。
 * 処理はその後(トランザクションの外)で行い、結果を complete / retry / giveUp で書く。結果は取り出したときの
 * リース(locked_by と attempts)が一致する行にだけ書く(リースが切れて取り直された後の古い処理は何も書かない)。
 * リースは1件の処理の最長時間(GAS Bridge の呼び出し 120 秒)より長くする。
 */
export class DrizzleOutboxQueue implements OutboxQueuePort {
  constructor(private readonly db: Database) {}

  async claimNext(workerId: string, leaseMs: number, now: Date): Promise<ClaimedOutboxMessage | null> {
    const lockedUntil = new Date(now.getTime() + leaseMs);
    const rows = await this.db.execute<{
      id: string;
      tenant_id: string;
      topic: OutboxTopic;
      aggregate_type: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
      attempts: number;
      max_attempts: number;
    }>(sql`
      with next as (
        select tenant_id, id from ${outboxMessages}
        where (status = 'pending' and available_at <= ${now.toISOString()}::timestamptz)
           or (status = 'processing' and locked_until < ${now.toISOString()}::timestamptz and attempts < max_attempts)
        order by available_at
        limit 1
        for update skip locked
      )
      update ${outboxMessages} m
      set status = 'processing', attempts = m.attempts + 1,
          locked_until = ${lockedUntil.toISOString()}::timestamptz, locked_by = ${workerId}
      from next
      where m.tenant_id = next.tenant_id and m.id = next.id
      returning m.id, m.tenant_id, m.topic, m.aggregate_type, m.aggregate_id, m.payload, m.attempts, m.max_attempts
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenant_id,
      topic: row.topic,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lockedBy: workerId,
    };
  }

  async expireExhaustedLeases(now: Date, error: string): Promise<ExpiredOutboxMessage[]> {
    return this.db
      .update(outboxMessages)
      .set({
        status: 'dead',
        lockedUntil: null,
        lockedBy: null,
        lastError: error.slice(0, 1000),
        completedAt: now,
      })
      .where(
        and(
          eq(outboxMessages.status, 'processing'),
          lt(outboxMessages.lockedUntil, now),
          gte(outboxMessages.attempts, outboxMessages.maxAttempts),
        ),
      )
      .returning({
        id: outboxMessages.id,
        tenantId: outboxMessages.tenantId,
        topic: outboxMessages.topic,
        aggregateId: outboxMessages.aggregateId,
        attempts: outboxMessages.attempts,
      });
  }

  /** 取り出したときのリースのままの行(別のワーカーが取り直していない)。 */
  private leased(lease: ClaimedOutboxMessage) {
    return and(
      eq(outboxMessages.tenantId, lease.tenantId),
      eq(outboxMessages.id, lease.id),
      eq(outboxMessages.status, 'processing'),
      eq(outboxMessages.lockedBy, lease.lockedBy),
      eq(outboxMessages.attempts, lease.attempts),
    );
  }

  private async finish(
    lease: ClaimedOutboxMessage,
    values: Partial<typeof outboxMessages.$inferInsert>,
  ): Promise<boolean> {
    const rows = await this.db
      .update(outboxMessages)
      .set({ lockedUntil: null, lockedBy: null, ...values })
      .where(this.leased(lease))
      .returning({ id: outboxMessages.id });
    return rows.length > 0;
  }

  complete(lease: ClaimedOutboxMessage, now: Date): Promise<boolean> {
    return this.finish(lease, { status: 'done', lastError: null, completedAt: now });
  }

  retry(lease: ClaimedOutboxMessage, error: string, availableAt: Date): Promise<boolean> {
    return this.finish(lease, { status: 'pending', lastError: error.slice(0, 1000), availableAt });
  }

  giveUp(lease: ClaimedOutboxMessage, error: string, status: 'failed' | 'dead', now: Date): Promise<boolean> {
    return this.finish(lease, { status, lastError: error.slice(0, 1000), completedAt: now });
  }
}
