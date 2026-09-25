import type { MirrorWorkerDeps, NightlyCalendarSyncDeps } from '@katahimo/core';
import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAppLogRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerImportStateRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzleOutboxRepository,
  DrizzleReceiptRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import type { CustomerCsvImportDeps } from '@katahimo/ingestion';
import {
  ConsoleAuditLogPort,
  createCustomerCsvSource,
  GasBridgeMirrorSenderPort,
  GasBridgeSchedulePort,
  LocalCryptoPort,
  LocalFileStoragePort,
  LocalKmsPort,
  NoopMirrorSenderPort,
  NoopSchedulePort,
} from '@katahimo/integrations';
import type { WorkerEnv } from './env';

/** ワーカーの全ジョブ(outboxミラー・夜間のカレンダー反映・顧客CSV取込)が使う依存一式。 */
export interface WorkerContainer extends MirrorWorkerDeps, NightlyCalendarSyncDeps, CustomerCsvImportDeps {
  tenants: DrizzleTenantRepository;
}

export function createWorkerContainer(env: WorkerEnv, db: Database): WorkerContainer {
  const kms = new LocalKmsPort(env.LOCAL_DEV_KEK);
  const crypto = new LocalCryptoPort(new DrizzleTenantKeyRepository(db), kms, new ConsoleAuditLogPort());
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;
  const outbox = new DrizzleOutboxRepository(db);

  return {
    tenants: new DrizzleTenantRepository(db),
    outbox,
    // ワーカー自身が積むミラー(夜間のカレンダー反映)も同じoutboxに積む。
    mirror: outbox,
    dailyReports: new DrizzleDailyReportRepository(db),
    accidentReports: new DrizzleAccidentReportRepository(db),
    receipts: new DrizzleReceiptRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    staff: new DrizzleStaffRepository(db),
    customers: new DrizzleCustomerRepository(db),
    familyMembers: new DrizzleFamilyMemberRepository(db),
    crypto,
    storage: new LocalFileStoragePort(env.LOCAL_RECEIPT_STORAGE_DIR),
    sender: gasBridgeOptions ? new GasBridgeMirrorSenderPort(gasBridgeOptions) : new NoopMirrorSenderPort(),
    // API(packages/api/src/container.ts)と同じ予定の取得元を使う。
    schedule: gasBridgeOptions ? new GasBridgeSchedulePort(gasBridgeOptions) : new NoopSchedulePort(),
    appLog: new DrizzleAppLogRepository(db),
    importState: new DrizzleCustomerImportStateRepository(db),
    csvSource: createCustomerCsvSource({
      driveFolderIdsByTenantSlug: env.CUSTOMER_CSV_DRIVE_FOLDERS,
      localDir: env.CUSTOMER_CSV_LOCAL_DIR,
    }),
    retryPolicy: {
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
      baseDelayMs: env.OUTBOX_RETRY_BASE_DELAY_MS,
      maxDelayMs: env.OUTBOX_RETRY_MAX_DELAY_MS,
    },
  };
}
