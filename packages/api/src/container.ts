import { ENCRYPTION_PURPOSES } from '@katahimo/core/domain';
import type {
  AppLogPort,
  CustomerCsvSourcePort,
  MapsPort,
  MirrorPort,
  NotifierPort,
  ReportAiPort,
  ReportAiPortFactory,
  SchedulePort,
  StoragePort,
} from '@katahimo/core/ports';
import type { RateLimitPolicy } from '@katahimo/core/usecases';
import {
  createScheduleDirectory,
  DEFAULT_RATE_LIMIT_POLICY,
  withRateLimitCounts,
} from '@katahimo/core/usecases';
import type { Database } from '@katahimo/db';
import {
  DrizzleAccidentReportRepository,
  DrizzleAiPromptRepository,
  DrizzleAppLogRepository,
  DrizzleAppSettingsRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerImportStateRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzleOutboxRepository,
  DrizzlePasswordResetCodeRepository,
  DrizzleRateLimiter,
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleStaffRouteProfileRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  ConsoleAuditLogPort,
  createCustomerCsvSource,
  createKeyManagementPort,
  createScheduleServices,
  createStoragePort,
  GeminiAiPort,
  InMemoryTtlCache,
  LocalBlindIndexPort,
  LocalCryptoPort,
  listAvailableGeminiModels,
  NoopMirrorPort,
  NoopReportAiPort,
  type ScheduleProvider,
  WebhookNotifierPort,
} from '@katahimo/integrations';
import { argon2PasswordHasher } from './authAdapters';
import type { Env } from './env';
import { deriveSecret } from './secrets';

/** ルートハンドラに配る依存一式。usecases(@katahimo/core)にそのまま渡す形。 */
export interface Container {
  tenants: DrizzleTenantRepository;
  staff: DrizzleStaffRepository;
  sessions: DrizzleSessionRepository;
  passwordResetCodes: DrizzlePasswordResetCodeRepository;
  customers: DrizzleCustomerRepository;
  familyMembers: DrizzleFamilyMemberRepository;
  attendanceDays: DrizzleAttendanceDayRepository;
  dailyReports: DrizzleDailyReportRepository;
  accidentReports: DrizzleAccidentReportRepository;
  receipts: DrizzleReceiptRepository;
  appSettings: DrizzleAppSettingsRepository;
  aiPrompts: DrizzleAiPromptRepository;
  crypto: LocalCryptoPort;
  blindIndex: LocalBlindIndexPort;
  passwordHasher: typeof argon2PasswordHasher;
  storage: StoragePort;
  notifier: NotifierPort;
  /**
   * パスワード再設定メールの送信ジョブ(kind='password_reset_mail')を積むoutbox。送信はワーカーが行う
   * (MIRROR_TO_GOOGLE_SHEETS の設定にかかわらず常に積む)。
   */
  mailOutbox: MirrorPort;
  /** 再設定コードのHMAC鍵(SESSION_SECRETからHKDFで導出した専用の鍵)。 */
  resetCodeSecret: string;
  /** ログイン・パスワード再設定・AI生成等の回数制限(rate_limit_buckets、インスタンス間で共有)。 */
  rateLimiter: DrizzleRateLimiter;
  rateLimits: RateLimitPolicy;
  /** テナントがapp_settingsに独自キーを設定していない場合のフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  /** テナント固有のGemini APIキー/モデルで都度ReportAiPortを組み立てるためのファクトリ。 */
  reportAiFactory: ReportAiPortFactory;
  /** 管理者設定画面の「最新モデル一覧を取得」用。 */
  listGeminiModels: typeof listAvailableGeminiModels;
  /** ジオコーディング/ルート計算(SCHEDULE_PROVIDER に応じて Google Maps Platform / GASブリッジ / Noop)。 */
  maps: MapsPort;
  /**
   * 「今日/明日の予定」。SCHEDULE_PROVIDER(未指定なら資格情報から自動選択)で GoogleSchedulePort /
   * GasBridgeSchedulePort / NoopSchedulePort を切り替える(doc/api/schedule-route.md)。
   */
  schedule: SchedulePort;
  scheduleProvider: ScheduleProvider;
  /** 日報/事故報告/領収書/勤怠のミラー書き込み要求をoutboxに積む(送信はpackages/worker)。 */
  mirror: MirrorPort;
  /** アプリ操作ログ・監査ログ(app_logs)。GAS版 logToBuffer に相当。 */
  appLog: AppLogPort;
  /** 顧客CSV取込の状態(最後に取り込んだ版・data_version)。 */
  importState: DrizzleCustomerImportStateRepository;
  /** 顧客CSVの取込元(Google Drive / ローカルディレクトリ)。管理者の手動取込で使う。 */
  csvSource: CustomerCsvSourcePort;
  /** GAS版 Script Properties AUTH_SALT と同じ値。移行済みスタッフのログインにのみ使う。 */
  legacyAuthSalt?: string;
  config: {
    /** セッションCookieのSecure属性に使う。 */
    isProduction: boolean;
  };
}

/** 環境変数 RATE_LIMIT_* で回数だけを差し替えた規則一式。 */
function rateLimitPolicyOf(env: Env): RateLimitPolicy {
  return withRateLimitCounts(DEFAULT_RATE_LIMIT_POLICY, {
    loginFailureAccount: env.RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT,
    loginFailureIp: env.RATE_LIMIT_LOGIN_FAILURES_PER_IP,
    passwordResetRequestAccount: env.RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_ACCOUNT,
    passwordResetRequestIp: env.RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_IP,
    aiGenerateStaff: env.RATE_LIMIT_AI_GENERATE_PER_STAFF_DAY,
    receiptOcrStaff: env.RATE_LIMIT_RECEIPT_OCR_PER_STAFF_DAY,
    scheduleForceRefreshStaff: env.RATE_LIMIT_SCHEDULE_REFRESH_PER_STAFF_HOUR,
  });
}

export function createContainer(env: Env, db: Database): Container {
  const kms = createKeyManagementPort(env);
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
    passwordResetCodes: new DrizzlePasswordResetCodeRepository(db),
    customers,
    familyMembers: new DrizzleFamilyMemberRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    dailyReports: new DrizzleDailyReportRepository(db),
    accidentReports: new DrizzleAccidentReportRepository(db),
    receipts: new DrizzleReceiptRepository(db),
    appSettings,
    aiPrompts: new DrizzleAiPromptRepository(db),
    crypto,
    blindIndex: new LocalBlindIndexPort(env.LOCAL_DEV_MASTER_KEY),
    passwordHasher: argon2PasswordHasher,
    storage: createStoragePort(env),
    notifier: new WebhookNotifierPort({
      async resolve(tenantId, channel) {
        const settings = await appSettings.find(tenantId);
        const encrypted =
          channel === 'report' ? settings?.gchatReportWebhookUrl : settings?.gchatReceiptWebhookUrl;
        if (encrypted) {
          return crypto.decrypt(
            tenantId,
            encrypted,
            channel === 'report'
              ? ENCRYPTION_PURPOSES.gchatReportWebhookUrl
              : ENCRYPTION_PURPOSES.gchatReceiptWebhookUrl,
          );
        }
        return channel === 'report' ? env.GCHAT_REPORT_WEBHOOK_URL : env.GCHAT_RECEIPT_WEBHOOK_URL;
      },
    }),
    mailOutbox: new DrizzleOutboxRepository(db),
    resetCodeSecret: deriveSecret(env.SESSION_SECRET, 'katahimo/password-reset-code/v1'),
    rateLimiter: new DrizzleRateLimiter(db, deriveSecret(env.SESSION_SECRET, 'katahimo/rate-limit-key/v1')),
    rateLimits: rateLimitPolicyOf(env),
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
    importState: new DrizzleCustomerImportStateRepository(db),
    csvSource: createCustomerCsvSource({
      driveFolderIdsByTenantSlug: env.CUSTOMER_CSV_DRIVE_FOLDERS,
      localDir: env.CUSTOMER_CSV_LOCAL_DIR,
    }),
    legacyAuthSalt: env.LEGACY_AUTH_SALT,
    config: { isProduction: env.NODE_ENV === 'production' },
  };
}
