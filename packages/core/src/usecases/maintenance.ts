import type { AppLogPort } from '../ports/appLog';
import type { PlatformMaintenancePort } from '../ports/maintenance';
import type { StoragePort } from '../ports/storage';
import type { TenantDirectoryPort } from '../ports/tenants';
import type { UnitOfWorkPort } from '../ports/unitOfWork';
import type { Clock } from './requestMeta';
import { currentTime } from './requestMeta';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 保存期間(日)。変えるときは doc/03_データベース設計.md 9章の保存期間の表も直す。 */
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

/** 操作ログの月のパーティションを何か月先まで作っておくか(保守ジョブが何日か止まっても足りるように)。 */
export const APP_LOG_PARTITION_MONTHS_AHEAD = 12;

export interface MaintenanceSummary {
  partitionsCreated: number;
  partitionsDropped: number;
  rateLimitBucketsDeleted: number;
  tenants: Array<{ tenantId: string; deleted: Record<string, number>; filesDeleted: number; error?: string }>;
  /** テナントに属さない処理(パーティション・レート制限)の失敗。 */
  errors: string[];
  /** 停止の合図で、全てのテナントを処理する前に止めた。 */
  interrupted: boolean;
}

/**
 * 保守ジョブ(毎日1回): 操作ログの月のパーティションを先に作り(既定のパーティションに入った行は月のパーティションへ
 * 移す)・古いものを消し、消去されていない全てのテナント(停止中・解約済みを含む)について保存期間を過ぎた
 * セッション・outbox・再設定コード・マッチングの候補を消し、期限切れ・使用済みの再設定コードのメール用の値を消し、
 * どこからも参照されないファイルを消す。
 * 1つの処理・1テナントの失敗で他を止めない。失敗は ERROR ログに残し、summary の errors / tenants[].error に入れる
 * (ジョブは失敗として終わる)。
 */
export async function runMaintenance(deps: MaintenanceDeps): Promise<MaintenanceSummary> {
  const now = currentTime(deps);
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const summary: MaintenanceSummary = {
    partitionsCreated: 0,
    partitionsDropped: 0,
    rateLimitBucketsDeleted: 0,
    tenants: [],
    errors: [],
    interrupted: false,
  };
  const platformStep = async (action: string, step: () => Promise<void>) => {
    try {
      await step();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${action}: ${message}`);
      await deps.appLog.write({
        tenantId: null,
        level: 'ERROR',
        action,
        actorType: 'system',
        details: { error: message.slice(0, 300) },
      });
    }
  };
  await platformStep('maintenance.app_log_partitions.create_failed', async () => {
    summary.partitionsCreated = await deps.platform.ensureAppLogPartitions(APP_LOG_PARTITION_MONTHS_AHEAD);
  });
  await platformStep('maintenance.app_log_partitions.drop_failed', async () => {
    summary.partitionsDropped = await deps.platform.dropAppLogPartitions(deps.appLogRetentionMonths);
  });
  await platformStep('maintenance.rate_limits.purge_failed', async () => {
    summary.rateLimitBucketsDeleted = await deps.platform.purgeRateLimitBuckets(
      ago(RETENTION_DAYS.rateLimitBuckets),
    );
  });
  for (const tenant of await deps.tenants.listAll()) {
    if (deps.shouldStop?.()) {
      summary.interrupted = true;
      break;
    }
    try {
      const { deleted, files } = await deps.uow.run(tenant.id, async (r) => ({
        deleted: await r.retention.purge({
          sessionsBefore: ago(RETENTION_DAYS.sessions),
          outboxDoneBefore: ago(RETENTION_DAYS.outboxDone),
          outboxFailedBefore: ago(RETENTION_DAYS.outboxFailed),
          passwordResetCodesBefore: ago(RETENTION_DAYS.passwordResetCodes),
          mailCodesExpiredAt: now,
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

/** 保守ジョブが最後まで成功したか(失敗が無く、途中で止めていない)。 */
export function maintenanceSucceeded(summary: MaintenanceSummary): boolean {
  return summary.errors.length === 0 && !summary.interrupted && summary.tenants.every((t) => !t.error);
}
