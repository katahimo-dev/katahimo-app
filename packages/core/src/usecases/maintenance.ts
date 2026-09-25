import type { AppLogPort } from '../ports/appLog';
import type { PlatformMaintenancePort } from '../ports/maintenance';
import type { StoragePort } from '../ports/storage';
import type { TenantDirectoryPort } from '../ports/tenants';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { Clock } from './requestMeta';
import { currentTime } from './requestMeta';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 保存期間(日)。変えるときは doc/09 の保存期間の表も直す。 */
export const RETENTION_DAYS = {
  /** 失効・期限切れのセッション。 */
  sessions: 30,
  outboxDone: 7,
  outboxFailed: 90,
  passwordResetCodes: 7,
  matchingCandidates: 90,
  rateLimitBuckets: 2,
  /** どこからも参照されないファイル(登録の途中で止まった画像等)を消すまでの猶予。 */
  unreferencedFiles: 1,
} as const;

export interface MaintenanceDeps extends Clock {
  uow: UnitOfWorkPort;
  tenants: TenantDirectoryPort;
  platform: PlatformMaintenancePort;
  storage: StoragePort;
  appLog: AppLogPort;
  /** 操作ログ(app_logs)を残す月数(パーティションごと消す)。 */
  appLogRetentionMonths: number;
  shouldStop?: () => boolean;
}

export interface MaintenanceSummary {
  partitionsCreated: number;
  partitionsDropped: number;
  rateLimitBucketsDeleted: number;
  tenants: Array<{ tenantId: string; deleted: Record<string, number>; filesDeleted: number; error?: string }>;
}

/**
 * 保守ジョブ(毎日1回): 操作ログの月のパーティションを先に作り・古いものを消し、テナントごとに保存期間を
 * 過ぎたセッション・outbox・再設定コード・マッチングの候補を消し、どこからも参照されないファイルを消す。
 * 1テナントの失敗で他を止めない。
 */
export async function runMaintenance(deps: MaintenanceDeps): Promise<MaintenanceSummary> {
  const now = currentTime(deps);
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const summary: MaintenanceSummary = {
    partitionsCreated: await deps.platform.ensureAppLogPartitions(3),
    partitionsDropped: await deps.platform.dropAppLogPartitions(deps.appLogRetentionMonths),
    rateLimitBucketsDeleted: await deps.platform.purgeRateLimitBuckets(ago(RETENTION_DAYS.rateLimitBuckets)),
    tenants: [],
  };
  for (const tenant of await deps.tenants.listActive()) {
    if (deps.shouldStop?.()) break;
    try {
      const { deleted, files } = await deps.uow.run(tenant.id, async (r) => ({
        deleted: await r.retention.purge({
          sessionsBefore: ago(RETENTION_DAYS.sessions),
          outboxDoneBefore: ago(RETENTION_DAYS.outboxDone),
          outboxFailedBefore: ago(RETENTION_DAYS.outboxFailed),
          passwordResetCodesBefore: ago(RETENTION_DAYS.passwordResetCodes),
          matchingCandidatesBefore: ago(RETENTION_DAYS.matchingCandidates),
        }),
        files: await r.storedFiles.listUnreferenced(ago(RETENTION_DAYS.unreferencedFiles), 500),
      }));
      let filesDeleted = 0;
      for (const file of files) {
        await deps.storage.delete(file.storageKey);
        await deps.uow.run(tenant.id, (r) => r.storedFiles.delete(file.id));
        filesDeleted++;
      }
      summary.tenants.push({ tenantId: tenant.id, deleted, filesDeleted });
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'INFO',
        action: 'maintenance.retention.done',
        actorType: 'system',
        details: { ...deleted, stored_files: filesDeleted },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.tenants.push({ tenantId: tenant.id, deleted: {}, filesDeleted: 0, error: message });
      await deps.appLog.write({
        tenantId: tenant.id,
        level: 'ERROR',
        action: 'maintenance.retention.failed',
        actorType: 'system',
        details: { error: message.slice(0, 300) },
      });
    }
  }
  return summary;
}
