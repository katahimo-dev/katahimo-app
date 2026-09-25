import type { MirrorWorkerDeps } from '@katahimo/core';
import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleOutboxRepository,
  DrizzleReceiptRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  ConsoleAuditLogPort,
  GasBridgeMirrorSenderPort,
  LocalCryptoPort,
  LocalFileStoragePort,
  LocalKmsPort,
  NoopMirrorSenderPort,
} from '@katahimo/integrations';
import type { WorkerEnv } from './env';

export interface WorkerContainer extends MirrorWorkerDeps {
  tenants: DrizzleTenantRepository;
}

export function createWorkerContainer(env: WorkerEnv, db: Database): WorkerContainer {
  const kms = new LocalKmsPort(env.LOCAL_DEV_KEK);
  const tenantKeys = new DrizzleTenantKeyRepository(db);
  const crypto = new LocalCryptoPort(tenantKeys, kms, new ConsoleAuditLogPort());
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;

  return {
    tenants: new DrizzleTenantRepository(db),
    outbox: new DrizzleOutboxRepository(db),
    dailyReports: new DrizzleDailyReportRepository(db),
    accidentReports: new DrizzleAccidentReportRepository(db),
    receipts: new DrizzleReceiptRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    staff: new DrizzleStaffRepository(db),
    customers: new DrizzleCustomerRepository(db),
    crypto,
    storage: new LocalFileStoragePort(env.LOCAL_RECEIPT_STORAGE_DIR),
    sender: gasBridgeOptions ? new GasBridgeMirrorSenderPort(gasBridgeOptions) : new NoopMirrorSenderPort(),
  };
}
