import type { AppLogEntry, AppLogPort } from '@katahimo/core/ports';
import type { Database } from '../client';
import { withTenant } from '../client';
import { appLogs } from '../schema';

/**
 * AppLogPortのDB実装(app_logsテーブルへ追記)。
 *
 * tenant_idがnullの行(ログイン前のイベント)はテナント未設定のままINSERTする
 * (app_logs_insertポリシーが tenant_id is null を許可している)。
 * 記録失敗は本来の処理に影響させない(AppLogPortの規約)。
 */
export class DrizzleAppLogRepository implements AppLogPort {
  constructor(private readonly db: Database) {}

  async write(entry: AppLogEntry): Promise<void> {
    const values = {
      tenantId: entry.tenantId,
      level: entry.level,
      action: entry.action,
      actorStaffId: entry.actorStaffId ?? null,
      targetStaffId: entry.targetStaffId ?? null,
      details: entry.details ?? {},
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    };
    try {
      if (entry.tenantId) {
        await withTenant(this.db, entry.tenantId, (tx) => tx.insert(appLogs).values(values));
      } else {
        await this.db.insert(appLogs).values(values);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          severity: 'ERROR',
          message: 'app_logs への記録に失敗',
          action: entry.action,
          error: String(err),
        }),
      );
    }
  }
}
