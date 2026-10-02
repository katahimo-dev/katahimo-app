import { errorMessageOf, newId } from '@katahimo/core/domain';
import type { AppLogEntry, AppLogPort } from '@katahimo/core/ports';
import { sql } from 'drizzle-orm';
import type { Database } from '../../client';
import { appLogs } from '../../customTables/appLogs';

/**
 * AppLogPort の実装(app_logs。追記のみ)。UoW のトランザクションとは独立に1件ずつ書く(処理が失敗・
 * ロールバックしても記録を残す)。テナントのある行は RLS の INSERT ポリシーのため同じトランザクションで
 * app.tenant_id を設定する。記録の失敗で本来の処理を止めないよう、例外は投げずに標準エラーへ出す。
 */
export class DrizzleAppLogRepository implements AppLogPort {
  constructor(private readonly db: Database) {}

  async write(entry: AppLogEntry): Promise<void> {
    const row = {
      id: newId(),
      tenantId: entry.tenantId,
      level: entry.level,
      action: entry.action,
      actorType: entry.actorStaffId
        ? ('staff' as const)
        : (entry.actorType ?? (entry.tenantId ? 'system' : 'anonymous')),
      actorId: entry.actorStaffId ?? null,
      targetType: entry.targetStaffId ? 'staff' : null,
      targetId: entry.targetStaffId ?? null,
      requestId: entry.requestId ?? null,
      details: entry.details ?? {},
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    };
    try {
      await this.db.transaction(async (tx) => {
        if (entry.tenantId)
          await tx.execute(sql`select set_config('app.tenant_id', ${entry.tenantId}, true)`);
        await tx.insert(appLogs).values(row);
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          severity: 'ERROR',
          message: 'app_logs への記録に失敗しました',
          action: entry.action,
          error: errorMessageOf(error),
        }),
      );
    }
  }
}
