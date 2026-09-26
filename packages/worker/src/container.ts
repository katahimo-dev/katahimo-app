import { hostname } from 'node:os';
import type {
  AppLogPort,
  CustomerCsvSourcePort,
  MailerPort,
  MirrorSenderPort,
  OutboxQueuePort,
  PlatformMaintenancePort,
  SchedulePort,
  StoragePort,
  TenantDirectoryPort,
  UnitOfWorkPort,
  WebPushSenderPort,
} from '@katahimo/core/ports';
import type { StaffBusyBlockSyncDeps } from '@katahimo/core/usecases';
import { createScheduleDirectory } from '@katahimo/core/usecases';
import type { Database } from '@katahimo/db';
import { DrizzleUnitOfWork } from '@katahimo/db';
import {
  DrizzleAppLogRepository,
  DrizzleOutboxQueue,
  DrizzlePlatformMaintenance,
  DrizzleTenantDirectory,
} from '@katahimo/db/repositories';
import {
  ConsoleMailerPort,
  createCustomerCsvSource,
  createGoogleCalendarPort,
  createScheduleServices,
  createStoragePort,
  GasBridgeMirrorSenderPort,
  InMemoryTtlCache,
  NoopMirrorSenderPort,
  SmtpMailerPort,
  skippedOutboxTopics,
  vapidDetailsOf,
  WebPushSender,
} from '@katahimo/integrations';
import type { WorkerEnv } from './env';

/**
 * ワーカーの全ジョブ(outbox・夜間のカレンダー反映・翌日の予定のお知らせ・顧客CSV取込・保守・free/busy 同期)が使う依存一式
 * (ポートの型だけで持つ)。usecase の Deps を構造的に満たす。
 */
export interface WorkerContainer {
  uow: UnitOfWorkPort;
  tenants: TenantDirectoryPort;
  queue: OutboxQueuePort;
  platform: PlatformMaintenancePort;
  storage: StoragePort;
  sender: MirrorSenderPort;
  mailer: MailerPort;
  appLog: AppLogPort;
  schedule: SchedulePort;
  csvSource: CustomerCsvSourcePort;
  /** MIRROR_TO_GOOGLE_SHEETS(API と同じ設定)。無効ならミラーのトピックは送らずに完了にする。 */
  mirrorEnabled: boolean;
  /** Web Push の送信(VAPID の設定が無ければ null。push.* は送らずに完了にし、お知らせのジョブは何もしない)。 */
  webPush: WebPushSenderPort | null;
  workerId: string;
  leaseMs: number;
  retryPolicy: { baseDelayMs: number; maxDelayMs: number };
  appLogRetentionMonths: number;
  /** job:sync-busy-blocks 用(Google Calendar freeBusy を使うため、実行時に初めて組み立てる)。 */
  busyBlockSync: () => StaffBusyBlockSyncDeps;
}

/** パスワード再設定メール。SMTP_HOST の設定時は SMTP、未設定(開発)時は標準出力。 */
function createMailer(env: WorkerEnv): MailerPort {
  if (!env.SMTP_HOST) return new ConsoleMailerPort();
  return new SmtpMailerPort({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    from: env.SMTP_FROM,
    ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
    ...(env.SMTP_PASS ? { pass: env.SMTP_PASS } : {}),
  });
}

export function createWorkerContainer(env: WorkerEnv, db: Database): WorkerContainer {
  const uow = new DrizzleUnitOfWork(db, { skipOutboxTopics: skippedOutboxTopics(env) });
  const appLog = new DrizzleAppLogRepository(db);
  const vapid = vapidDetailsOf(env);
  const bridge =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;
  // API と同じ予定・ルート計算の実装を使う(夜間の反映は fresh のためルートのキャッシュは使わない)
  const scheduleServices = createScheduleServices(env, {
    directory: createScheduleDirectory({ uow }),
    appLog,
    routeCache: new InMemoryTtlCache({ maxEntries: 100 }),
  });

  return {
    uow,
    tenants: new DrizzleTenantDirectory(db),
    queue: new DrizzleOutboxQueue(db),
    platform: new DrizzlePlatformMaintenance(db),
    storage: createStoragePort(env),
    sender: bridge ? new GasBridgeMirrorSenderPort(bridge) : new NoopMirrorSenderPort(),
    mailer: createMailer(env),
    appLog,
    schedule: scheduleServices.schedule,
    csvSource: createCustomerCsvSource({
      driveFolderIdsByTenantSlug: env.CUSTOMER_CSV_DRIVE_FOLDERS,
      ...(env.CUSTOMER_CSV_LOCAL_DIR ? { localDir: env.CUSTOMER_CSV_LOCAL_DIR } : {}),
    }),
    mirrorEnabled: env.MIRROR_TO_GOOGLE_SHEETS,
    webPush: vapid ? new WebPushSender(vapid) : null,
    workerId: `${hostname()}:${process.pid}`,
    leaseMs: env.OUTBOX_LEASE_MS,
    retryPolicy: { baseDelayMs: env.OUTBOX_RETRY_BASE_DELAY_MS, maxDelayMs: env.OUTBOX_RETRY_MAX_DELAY_MS },
    appLogRetentionMonths: env.APP_LOG_RETENTION_MONTHS,
    busyBlockSync: () => ({ uow, calendar: createGoogleCalendarPort(env), appLog }),
  };
}
