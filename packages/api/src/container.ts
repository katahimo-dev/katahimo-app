import type {
  AppLogPort,
  MapsPort,
  MirrorPort,
  NotifierPort,
  ReportAiPort,
  ReportAiPortFactory,
  SchedulePort,
  StoragePort,
} from '@katahimo/core/ports';
import { createScheduleDirectory } from '@katahimo/core/usecases';
import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAppLogRepository,
  DrizzleAppSettingsRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzleOutboxRepository,
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleStaffRouteProfileRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  ConsoleAuditLogPort,
  createScheduleServices,
  GeminiAiPort,
  InMemoryTtlCache,
  LocalBlindIndexPort,
  LocalCryptoPort,
  LocalFileStoragePort,
  LocalKmsPort,
  listAvailableGeminiModels,
  NoopMirrorPort,
  NoopReportAiPort,
  type ScheduleProvider,
  WebhookNotifierPort,
} from '@katahimo/integrations';
import { argon2PasswordHasher } from './authAdapters';
import type { Env } from './env';

/** ルートハンドラに配る依存一式。usecases(@katahimo/core)にそのまま渡す形。 */
export interface Container {
  tenants: DrizzleTenantRepository;
  staff: DrizzleStaffRepository;
  sessions: DrizzleSessionRepository;
  customers: DrizzleCustomerRepository;
  familyMembers: DrizzleFamilyMemberRepository;
  attendanceDays: DrizzleAttendanceDayRepository;
  dailyReports: DrizzleDailyReportRepository;
  accidentReports: DrizzleAccidentReportRepository;
  receipts: DrizzleReceiptRepository;
  appSettings: DrizzleAppSettingsRepository;
  crypto: LocalCryptoPort;
  blindIndex: LocalBlindIndexPort;
  passwordHasher: typeof argon2PasswordHasher;
  storage: StoragePort;
  notifier: NotifierPort;
  /** テナントがapp_settingsに独自キーを設定していない場合のフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  /** テナント固有のGemini APIキー/モデルで都度ReportAiPortを組み立てるためのファクトリ。 */
  reportAiFactory: ReportAiPortFactory;
  /** 管理者設定画面の「最新モデル一覧を取得」用。保存前の入力中キーでも確認できるよう独立させている。 */
  listGeminiModels: typeof listAvailableGeminiModels;
  /** ジオコーディング/ルート計算(SCHEDULE_PROVIDER に応じて Google Maps Platform / GASブリッジ / Noop)。 */
  maps: MapsPort;
  /**
   * 「今日/明日の予定」。SCHEDULE_PROVIDER(未指定なら資格情報から自動選択)で GoogleSchedulePort /
   * GasBridgeSchedulePort / NoopSchedulePort を切り替える(doc/api/schedule-route.md)。
   */
  schedule: SchedulePort;
  scheduleProvider: ScheduleProvider;
  /**
   * 日報/事故報告/領収書/勤怠のミラー書き込み要求をoutboxに積む(Phase 5)。実際の送信
   * (GAS版スプレッドシート/Driveへの反映)はAPIサーバーではなくワーカー(packages/worker)が行う。
   */
  mirror: MirrorPort;
  /** アプリ操作ログ・監査ログ(app_logs)。GAS版 logToBuffer に相当。 */
  appLog: AppLogPort;
  /** GAS版 Script Properties AUTH_SALT と同じ値。移行済みスタッフのログインにのみ使う。 */
  legacyAuthSalt?: string;
}

export function createContainer(env: Env, db: Database): Container {
  const kms = new LocalKmsPort(env.LOCAL_DEV_KEK);
  const tenantKeys = new DrizzleTenantKeyRepository(db);
  const crypto = new LocalCryptoPort(tenantKeys, kms, new ConsoleAuditLogPort());
  const appSettings = new DrizzleAppSettingsRepository(db);
  const customers = new DrizzleCustomerRepository(db);
  const appLog = new DrizzleAppLogRepository(db);
  const scheduleServices = createScheduleServices(env, {
    directory: createScheduleDirectory({
      customers,
      staffRouteProfiles: new DrizzleStaffRouteProfileRepository(db),
      crypto,
    }),
    appLog,
    // ルート結果の共有キャッシュ(GAS版CacheService相当)。プロセス内のため Cloud Run の
    // インスタンス間では共有されない。1件=1スタッフ×1日の結果。
    routeCache: new InMemoryTtlCache({ maxEntries: 2000 }),
  });
  console.info(`予定・ルート計算の実装: ${scheduleServices.provider}`);

  return {
    tenants: new DrizzleTenantRepository(db),
    staff: new DrizzleStaffRepository(db),
    sessions: new DrizzleSessionRepository(db),
    customers,
    familyMembers: new DrizzleFamilyMemberRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    dailyReports: new DrizzleDailyReportRepository(db),
    accidentReports: new DrizzleAccidentReportRepository(db),
    receipts: new DrizzleReceiptRepository(db),
    appSettings,
    crypto,
    blindIndex: new LocalBlindIndexPort(env.LOCAL_DEV_MASTER_KEY),
    passwordHasher: argon2PasswordHasher,
    storage: new LocalFileStoragePort(env.LOCAL_RECEIPT_STORAGE_DIR),
    notifier: new WebhookNotifierPort({
      async resolve(tenantId, channel) {
        const settings = await appSettings.find(tenantId);
        const encrypted =
          channel === 'report' ? settings?.gchatReportWebhookUrl : settings?.gchatReceiptWebhookUrl;
        if (encrypted) return crypto.decrypt(tenantId, encrypted);
        return channel === 'report' ? env.GCHAT_REPORT_WEBHOOK_URL : env.GCHAT_RECEIPT_WEBHOOK_URL;
      },
    }),
    reportAi: env.GEMINI_API_KEY
      ? new GeminiAiPort({
          apiKey: env.GEMINI_API_KEY,
          reportModel: env.GEMINI_MODEL_REPORT,
          ocrModel: env.GEMINI_MODEL_OCR,
        })
      : new NoopReportAiPort(),
    reportAiFactory: { create: (opts) => new GeminiAiPort(opts) },
    listGeminiModels: listAvailableGeminiModels,
    maps: scheduleServices.maps,
    schedule: scheduleServices.schedule,
    scheduleProvider: scheduleServices.provider,
    mirror: env.MIRROR_TO_GOOGLE_SHEETS ? new DrizzleOutboxRepository(db) : new NoopMirrorPort(),
    appLog,
    legacyAuthSalt: env.LEGACY_AUTH_SALT,
  };
}
