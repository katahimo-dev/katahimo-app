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
  gasBridgeConfigOf,
  InMemoryTtlCache,
  NoopMirrorSenderPort,
  outboxTopicPolicyOf,
  SmtpMailerPort,
  vapidDetailsOf,
  WebPushSender,
} from '@katahimo/integrations';
import type { WorkerEnv } from './env';

/**
 * ワーカーの全ジョブ(outbox-drain・夜間のカレンダー反映・翌日の予定のお知らせ・顧客CSV取込・保守・free/busy 同期)が使う依存一式
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
  /** 画面の URL(APP_PUBLIC_URL。パスワード設定の案内のメールに書く)。 */
  appPublicUrl?: string;
  appLog: AppLogPort;
  schedule: SchedulePort;
  /** 予定を読めるテナントの slug(SCHEDULE_PROVIDER=gas_bridge の GAS_BRIDGE_TENANT)。null なら全テナント。 */
  scheduleTenantSlug: string | null;
  csvSource: CustomerCsvSourcePort;
  /**
   * ミラーするテナントの slug(MIRROR_TO_GOOGLE_SHEETS が有効な時の GAS_BRIDGE_TENANT。API と同じ設定)。
   * null ならミラーのトピックは送らずに完了にし、別のテナントのミラーも送らない。
   */
  mirrorTenantSlug: string | null;
  /** Web Push の送信(VAPID の設定が無ければ null。push.* は送らずに完了にし、お知らせのジョブは何もしない)。 */
  webPush: WebPushSenderPort | null;
  workerId: string;
  leaseMs: number;
  /** 1回の実行で続けて処理する outbox の最大件数(OUTBOX_DRAIN_MAX)。 */
  outboxDrainMax: number;
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
  const outboxPolicy = outboxTopicPolicyOf(env);
  const uow = new DrizzleUnitOfWork(db, { outboxPolicy });
  const appLog = new DrizzleAppLogRepository(db);
  const tenants = new DrizzleTenantDirectory(db);
  const vapid = vapidDetailsOf(env);
  const bridge = gasBridgeConfigOf(env);
  // API と同じ予定・ルート計算の実装を使う(夜間の反映は fresh のため地図の結果のキャッシュは使わない)
  const scheduleServices = createScheduleServices(env, {
    directory: createScheduleDirectory({ uow }),
    appLog,
    mapsCache: new InMemoryTtlCache({ maxEntries: 100 }),
    calendarCache: new InMemoryTtlCache({ maxEntries: 100 }),
    tenants,
  });

  return {
    uow,
    tenants,
    queue: new DrizzleOutboxQueue(db),
    platform: new DrizzlePlatformMaintenance(db),
    storage: createStoragePort(env),
    sender: bridge ? new GasBridgeMirrorSenderPort(bridge) : new NoopMirrorSenderPort(),
    mailer: createMailer(env),
    ...(env.APP_PUBLIC_URL ? { appPublicUrl: env.APP_PUBLIC_URL } : {}),
    appLog,
    schedule: scheduleServices.schedule,
    scheduleTenantSlug: scheduleServices.scheduleTenantSlug,
    csvSource: createCustomerCsvSource({
      ...(env.CUSTOMER_CSV_LOCAL_DIR ? { localDir: env.CUSTOMER_CSV_LOCAL_DIR } : {}),
    }),
    mirrorTenantSlug: outboxPolicy.mirrorTenantSlug,
    webPush: vapid ? new WebPushSender(vapid) : null,
    workerId: `${hostname()}:${process.pid}`,
    leaseMs: env.OUTBOX_LEASE_MS,
    outboxDrainMax: env.OUTBOX_DRAIN_MAX,
    retryPolicy: { baseDelayMs: env.OUTBOX_RETRY_BASE_DELAY_MS, maxDelayMs: env.OUTBOX_RETRY_MAX_DELAY_MS },
    appLogRetentionMonths: env.APP_LOG_RETENTION_MONTHS,
    busyBlockSync: () => ({ uow, calendar: createGoogleCalendarPort(env), appLog }),
  };
}
