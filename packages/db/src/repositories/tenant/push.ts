import type {
  PushSubscriptionRecord,
  PushSubscriptionRepository,
  PushSubscriptionUpsert,
} from '@katahimo/core/ports';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { pushSubscriptions } from '../../schema';
import { TenantBound } from './base';

const columns = {
  id: pushSubscriptions.id,
  staffId: pushSubscriptions.staffId,
  endpoint: pushSubscriptions.endpoint,
  p256dh: pushSubscriptions.p256dh,
  auth: pushSubscriptions.auth,
  userAgent: pushSubscriptions.userAgent,
  createdAt: pushSubscriptions.createdAt,
  updatedAt: pushSubscriptions.updatedAt,
  lastSuccessAt: pushSubscriptions.lastSuccessAt,
  failureCount: pushSubscriptions.failureCount,
};

/** Web Push の購読(テナントの中で endpoint が一意)。 */
export class DrizzlePushSubscriptionRepository extends TenantBound implements PushSubscriptionRepository {
  private byId(id: string) {
    return and(eq(pushSubscriptions.tenantId, this.tenantId), eq(pushSubscriptions.id, id));
  }

  async findById(id: string): Promise<PushSubscriptionRecord | null> {
    const rows = await this.tx.select(columns).from(pushSubscriptions).where(this.byId(id));
    return rows[0] ?? null;
  }

  async findByEndpoint(endpoint: string): Promise<PushSubscriptionRecord | null> {
    const rows = await this.tx
      .select(columns)
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, this.tenantId), eq(pushSubscriptions.endpoint, endpoint)));
    return rows[0] ?? null;
  }

  async upsert(input: PushSubscriptionUpsert): Promise<PushSubscriptionRecord> {
    const [row] = await this.tx
      .insert(pushSubscriptions)
      .values({ tenantId: this.tenantId, ...input })
      .onConflictDoUpdate({
        target: [pushSubscriptions.tenantId, pushSubscriptions.endpoint],
        set: {
          staffId: input.staffId,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent,
          failureCount: 0,
          lastFailureAt: null,
        },
      })
      .returning(columns);
    if (!row) throw new Error('通知の購読を保存できませんでした');
    return row;
  }

  async trimForStaff(staffId: string, keep: number): Promise<number> {
    const own = and(eq(pushSubscriptions.tenantId, this.tenantId), eq(pushSubscriptions.staffId, staffId));
    const stale = await this.tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(own)
      .orderBy(desc(pushSubscriptions.updatedAt), desc(pushSubscriptions.id))
      .offset(keep);
    if (stale.length === 0) return 0;
    const deleted = await this.tx
      .delete(pushSubscriptions)
      .where(
        and(
          own,
          inArray(
            pushSubscriptions.id,
            stale.map((row) => row.id),
          ),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return deleted.length;
  }

  async deleteAllForStaff(staffId: string): Promise<number> {
    const deleted = await this.tx
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, this.tenantId), eq(pushSubscriptions.staffId, staffId)))
      .returning({ id: pushSubscriptions.id });
    return deleted.length;
  }

  async deleteForStaff(staffId: string, endpoint: string): Promise<string | null> {
    const rows = await this.tx
      .delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.tenantId, this.tenantId),
          eq(pushSubscriptions.staffId, staffId),
          eq(pushSubscriptions.endpoint, endpoint),
        ),
      )
      .returning({ id: pushSubscriptions.id });
    return rows[0]?.id ?? null;
  }

  async listForStaff(staffId: string): Promise<PushSubscriptionRecord[]> {
    return this.tx
      .select(columns)
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.tenantId, this.tenantId), eq(pushSubscriptions.staffId, staffId)))
      .orderBy(asc(pushSubscriptions.createdAt), asc(pushSubscriptions.id));
  }

  async listSubscribedStaffIds(): Promise<string[]> {
    const rows = await this.tx
      .selectDistinct({ staffId: pushSubscriptions.staffId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.tenantId, this.tenantId));
    return rows.map((r) => r.staffId);
  }

  async recordSuccess(id: string, at: Date): Promise<void> {
    await this.tx.update(pushSubscriptions).set({ lastSuccessAt: at, failureCount: 0 }).where(this.byId(id));
  }

  async recordRetryableFailure(id: string, at: Date): Promise<void> {
    await this.tx.update(pushSubscriptions).set({ lastFailureAt: at }).where(this.byId(id));
  }

  async recordRejection(id: string, at: Date): Promise<number> {
    const [row] = await this.tx
      .update(pushSubscriptions)
      .set({ lastFailureAt: at, failureCount: sql`${pushSubscriptions.failureCount} + 1` })
      .where(this.byId(id))
      .returning({ failureCount: pushSubscriptions.failureCount });
    return row?.failureCount ?? 0;
  }

  async delete(id: string): Promise<void> {
    await this.tx.delete(pushSubscriptions).where(this.byId(id));
  }
}
