import type {
  AppLogPort,
  CustomerCsvSourcePort,
  MailerPort,
  MapsPort,
  MirrorPort,
  NotifierPort,
  ReportAiPort,
  ReportAiPortFactory,
  SchedulePort,
  StoragePort,
} from '@katahimo/core/ports';
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
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  ConsoleAuditLogPort,
  ConsoleMailerPort,
  createCustomerCsvSource,
  GasBridgeMapsPort,
  GasBridgeSchedulePort,
  GeminiAiPort,
  LocalBlindIndexPort,
  LocalCryptoPort,
  LocalFileStoragePort,
  LocalKmsPort,
  listAvailableGeminiModels,
  NoopMapsPort,
  NoopMirrorPort,
  NoopReportAiPort,
  NoopSchedulePort,
  SmtpMailerPort,
  WebhookNotifierPort,
} from '@katahimo/integrations';
import { argon2PasswordHasher } from './authAdapters';
import type { Env } from './env';

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
  /** パスワード再設定メール。SMTP_HOST設定時はSMTP、未設定(開発)時は標準出力。 */
  mailer: MailerPort;
  /** 再設定コードのHMAC鍵(SESSION_SECRETを流用する)。 */
  resetCodeSecret: string;
  /** テナントがapp_settingsに独自キーを設定していない場合のフォールバック(.env設定 or Noop)。 */
  reportAi: ReportAiPort;
  /** テナント固有のGemini APIキー/モデルで都度ReportAiPortを組み立てるためのファクトリ。 */
  reportAiFactory: ReportAiPortFactory;
  /** 管理者設定画面の「最新モデル一覧を取得」用。 */
  listGeminiModels: typeof listAvailableGeminiModels;
  /**
   * ジオコーディング/ルート計算。GAS_BRIDGE_URL/GAS_BRIDGE_SECRETが設定されていれば
   * gas-childcare-visit-appのWeb App(Bridge.js)をプロキシとして使い、未設定ならNoopMapsPort
   * (常にnull)にフォールバックする。
   */
  maps: MapsPort;
  /** 「今日/明日の予定」閲覧。GAS_BRIDGE_*設定時はBridge.js経由、未設定ならNoop(常に予定なし)。 */
  schedule: SchedulePort;
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

function createMailer(env: Env): MailerPort {
  if (!env.SMTP_HOST) return new ConsoleMailerPort();
  return new SmtpMailerPort({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM,
  });
}

export function createContainer(env: Env, db: Database): Container {
  const kms = new LocalKmsPort(env.LOCAL_DEV_KEK);
  const tenantKeys = new DrizzleTenantKeyRepository(db);
  const crypto = new LocalCryptoPort(tenantKeys, kms, new ConsoleAuditLogPort());
  const appSettings = new DrizzleAppSettingsRepository(db);
  const gasBridgeOptions =
    env.GAS_BRIDGE_URL && env.GAS_BRIDGE_SECRET
      ? { baseUrl: env.GAS_BRIDGE_URL, secret: env.GAS_BRIDGE_SECRET }
      : null;

  return {
    tenants: new DrizzleTenantRepository(db),
    staff: new DrizzleStaffRepository(db),
    sessions: new DrizzleSessionRepository(db),
    passwordResetCodes: new DrizzlePasswordResetCodeRepository(db),
    customers: new DrizzleCustomerRepository(db),
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
    mailer: createMailer(env),
    resetCodeSecret: env.SESSION_SECRET,
    reportAi: env.GEMINI_API_KEY
      ? new GeminiAiPort({
          apiKey: env.GEMINI_API_KEY,
          reportModel: env.GEMINI_MODEL_REPORT,
          ocrModel: env.GEMINI_MODEL_OCR,
        })
      : new NoopReportAiPort(),
    reportAiFactory: { create: (opts) => new GeminiAiPort(opts) },
    listGeminiModels: listAvailableGeminiModels,
    maps: gasBridgeOptions ? new GasBridgeMapsPort(gasBridgeOptions) : new NoopMapsPort(),
    schedule: gasBridgeOptions ? new GasBridgeSchedulePort(gasBridgeOptions) : new NoopSchedulePort(),
    mirror: env.MIRROR_TO_GOOGLE_SHEETS ? new DrizzleOutboxRepository(db) : new NoopMirrorPort(),
    appLog: new DrizzleAppLogRepository(db),
    importState: new DrizzleCustomerImportStateRepository(db),
    csvSource: createCustomerCsvSource({
      driveFolderIdsByTenantSlug: env.CUSTOMER_CSV_DRIVE_FOLDERS,
      localDir: env.CUSTOMER_CSV_LOCAL_DIR,
    }),
    legacyAuthSalt: env.LEGACY_AUTH_SALT,
    config: { isProduction: env.NODE_ENV === 'production' },
  };
}
