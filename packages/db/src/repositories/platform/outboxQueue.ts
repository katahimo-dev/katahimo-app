import type { OutboxTopic } from '@katahimo/core/domain';
import type { ClaimedOutboxMessage, OutboxQueuePort } from '@katahimo/core/ports';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../../client';
import { outboxMessages } from '../../schema';

/**
 * ワーカー側の outbox。katahimo_worker で接続し、テナントを横断して取る(outbox_messages_worker ポリシー)。
 * 取り出しは1件ずつ: 取れるもの(pending で available_at を過ぎた・processing でリースが切れた)を
 * FOR UPDATE SKIP LOCKED で1行押さえ、processing・locked_until = now + リースにしてすぐコミットする。
 * 処理はその後(トランザクションの外)で行い、結果を complete / retry / giveUp で書く。リースは1件の処理の
 * 最長時間(GAS Bridge の呼び出し 120 秒)より長くする。
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
           or (status = 'processing' and locked_until < ${now.toISOString()}::timestamptz)
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
    };
  }

  private byId(id: string, tenantId: string) {
    return and(
      eq(outboxMessages.tenantId, tenantId),
      eq(outboxMessages.id, id),
      eq(outboxMessages.status, 'processing'),
    );
  }

  async complete(id: string, tenantId: string, now: Date): Promise<void> {
    await this.db
      .update(outboxMessages)
      .set({ status: 'done', lockedUntil: null, lockedBy: null, lastError: null, completedAt: now })
      .where(this.byId(id, tenantId));
  }

  async retry(id: string, tenantId: string, error: string, availableAt: Date): Promise<void> {
    await this.db
      .update(outboxMessages)
      .set({
        status: 'pending',
        lockedUntil: null,
        lockedBy: null,
        lastError: error.slice(0, 1000),
        availableAt,
      })
      .where(this.byId(id, tenantId));
  }

  async giveUp(
    id: string,
    tenantId: string,
    error: string,
    status: 'failed' | 'dead',
    now: Date,
  ): Promise<void> {
    await this.db
      .update(outboxMessages)
      .set({ status, lockedUntil: null, lockedBy: null, lastError: error.slice(0, 1000), completedAt: now })
      .where(this.byId(id, tenantId));
  }
}
