import type { AppLogFilter, AppLogPosition, AppLogReadRepository, AppLogRecord } from '@katahimo/core/ports';
import { and, desc, eq, gte, lt, or, type SQL, sql } from 'drizzle-orm';
import { appLogs } from '../../customTables/appLogs';
import { TenantBound } from './base';

/**
 * 操作ログ(app_logs)の読み取り。UoW のテナントの行だけを読む(RLS の app_logs_select でも同じ。tenant_id が
 * null のログイン前の行はどのテナントにも見せない)。月のパーティションは created_at の範囲で絞られ、
 * (tenant_id, created_at) の索引で新しい順に読む。
 */
export class DrizzleAppLogReadRepository extends TenantBound implements AppLogReadRepository {
  async list(
    filter: AppLogFilter,
    page: { after: AppLogPosition | null; limit: number },
  ): Promise<AppLogRecord[]> {
    const conditions: (SQL | undefined)[] = [
      eq(appLogs.tenantId, this.tenantId),
      gte(appLogs.createdAt, filter.from),
      lt(appLogs.createdAt, filter.to),
      filter.level ? eq(appLogs.level, filter.level) : undefined,
      filter.staffId
        ? or(eq(appLogs.actorId, filter.staffId), eq(appLogs.targetId, filter.staffId))
        : undefined,
      filter.actionPrefix ? sql`starts_with(${appLogs.action}, ${filter.actionPrefix})` : undefined,
      page.after
        ? sql`(${appLogs.createdAt}, ${appLogs.id}) < (${page.after.at}::timestamptz, ${page.after.id}::uuid)`
        : undefined,
    ];
    const rows = await this.tx
      .select({
        id: appLogs.id,
        createdAt: appLogs.createdAt,
        at: sql<string>`${appLogs.createdAt}::text`,
        level: appLogs.level,
        action: appLogs.action,
        actorType: appLogs.actorType,
        actorId: appLogs.actorId,
        targetType: appLogs.targetType,
        targetId: appLogs.targetId,
        details: appLogs.details,
        ip: sql<string | null>`host(${appLogs.ip})`,
        userAgent: appLogs.userAgent,
        requestId: appLogs.requestId,
      })
      .from(appLogs)
      .where(and(...conditions))
      .orderBy(desc(appLogs.createdAt), desc(appLogs.id))
      .limit(page.limit);
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      position: { at: row.at, id: row.id },
      level: row.level,
      action: row.action,
      actorType: row.actorType,
      actorStaffId: row.actorType === 'staff' ? row.actorId : null,
      targetStaffId: row.targetType === 'staff' ? row.targetId : null,
      details: row.details,
      ip: row.ip,
      userAgent: row.userAgent,
      requestId: row.requestId,
    }));
  }
}
