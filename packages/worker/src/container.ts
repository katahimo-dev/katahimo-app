import type { MirrorWorkerDeps, NightlyCalendarSyncDeps, StaffBusyBlockSyncDeps } from '@katahimo/core';
import type { MailerPort } from '@katahimo/core/ports';
import { createScheduleDirectory } from '@katahimo/core/usecases';
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
  DrizzlePasswordResetCodeRepository,
  DrizzleReceiptRepository,
  DrizzleStaffBusyBlockRepository,
  DrizzleStaffRepository,
  DrizzleStaffRouteProfileRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import type { CustomerCsvImportDeps } from '@katahimo/ingestion';
import {
  ConsoleAuditLogPort,
  ConsoleMailerPort,
  createCustomerCsvSource,
  createGoogleCalendarPort,
  createKeyManagementPort,
  createScheduleServices,
  createStoragePort,
  GasBridgeMirrorSenderPort,
  InMemoryTtlCache,
  LocalCryptoPort,
  NoopMirrorSenderPort,
  SmtpMailerPort,
} from '@katahimo/integrations';
import type { WorkerEnv } from './env';

/** ワーカーの全ジョブ(outboxミラー・夜間のカレンダー反映・顧客CSV取込・free/busy同期)が使う依存一式。 */
export interface WorkerContainer extends MirrorWorkerDeps, NightlyCalendarSyncDeps, CustomerCsvImportDeps {
  tenants: DrizzleTenantRepository;
  /** job:sync-busy-blocks 用(Google Calendar freeBusy を使うため、実行時に初めて組み立てる)。 */
  busyBlockSync: () => StaffBusyBlockSyncDeps;
}

/** パスワード再設定メール。SMTP_HOST設定時はSMTP、未設定(開発)時は標準出力。 */
function createMailer(env: WorkerEnv): MailerPort {
  if (!env.SMTP_HOST) return new ConsoleMailerPort();
  return new SmtpMailerPort({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  });
}

export function createWorkerContainer(env: WorkerEnv, db: Database): WorkerContainer {
  const kms = createKeyManagementPort(env);
  const crypto = new LocalCryptoPort(new DrizzleTenantKeyRepository(db), kms, new ConsoleAuditLogPort());
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;
  const outbox = new DrizzleOutboxRepository(db);
  const customers = new DrizzleCustomerRepository(db);
  const staffRouteProfiles = new DrizzleStaffRouteProfileRepository(db);
  const appLog = new DrizzleAppLogRepository(db);
  // APIと同じ予定・ルート計算の実装を使う。夜間反映は fresh 指定のためキャッシュは実質使わない。
  const scheduleServices = createScheduleServices(env, {
    directory: createScheduleDirectory({ customers, staffRouteProfiles, crypto }),
    appLog,
    routeCache: new InMemoryTtlCache({ maxEntries: 100 }),
  });

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
    customers,
    familyMembers: new DrizzleFamilyMemberRepository(db),
    crypto,
    storage: createStoragePort(env),
    sender: gasBridgeOptions ? new GasBridgeMirrorSenderPort(gasBridgeOptions) : new NoopMirrorSenderPort(),
    passwordResetCodes: new DrizzlePasswordResetCodeRepository(db),
    mailer: createMailer(env),
    schedule: scheduleServices.schedule,
    appLog,
    busyBlockSync: () => ({
      calendar: createGoogleCalendarPort(env),
      staffRouteProfiles,
      busyBlocks: new DrizzleStaffBusyBlockRepository(db),
      appLog,
    }),
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
