import type { PlatformMaintenancePort } from '@katahimo/core/ports';
import { lt, sql } from 'drizzle-orm';
import type { Database } from '../../client';
import { rateLimitBuckets } from '../../schema';

/** テナントを横断する保守(ワーカーの katahimo_worker で実行する)。 */
export class DrizzlePlatformMaintenance implements PlatformMaintenancePort {
  constructor(private readonly db: Database) {}

  async purgeRateLimitBuckets(updatedBefore: Date): Promise<number> {
    const rows = await this.db
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.updatedAt, updatedBefore))
      .returning({ rule: rateLimitBuckets.rule });
    return rows.length;
  }

  async ensureAppLogPartitions(monthsAhead: number): Promise<number> {
    const [row] = await this.db.execute<{ n: number }>(
      sql`select platform.ensure_app_log_partitions(${monthsAhead}) as n`,
    );
    return Number(row?.n ?? 0);
  }

  async dropAppLogPartitions(retainMonths: number): Promise<number> {
    const [row] = await this.db.execute<{ n: number }>(
      sql`select platform.drop_app_log_partitions(${retainMonths}) as n`,
    );
    return Number(row?.n ?? 0);
  }
}
