import type {
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
  DrizzleAppSettingsRepository,
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleDailyReportRepository,
  DrizzleFamilyMemberRepository,
  DrizzleOutboxRepository,
  DrizzleReceiptRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantKeyRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import {
  ConsoleAuditLogPort,
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
  /**
   * ジオコーディング/ルート計算。GAS_BRIDGE_URL/GAS_BRIDGE_SECRETが設定されていれば
   * gas-childcare-visit-appのWeb App(Bridge.js)をプロキシとして使い、未設定ならNoopMapsPort
   * (常にnull)にフォールバックする。
   */
  maps: MapsPort;
  /**
   * 「今日/明日の予定」閲覧。GAS_BRIDGE_URL/GAS_BRIDGE_SECRETが設定されていれば
   * gas-childcare-visit-appのWeb App(Bridge.js、既存のカレンダー解析・ルート計算ロジックを
   * そのまま使う)をプロキシとして使い、未設定ならNoopSchedulePort(常に予定なし)に
   * フォールバックする。
   */
  schedule: SchedulePort;
  /**
   * 日報/事故報告/領収書/勤怠のミラー書き込み要求をoutboxに積む(Phase 5)。実際の送信
   * (GAS版スプレッドシート/Driveへの反映)はAPIサーバーではなくワーカー(packages/worker)が行う。
   */
  mirror: MirrorPort;
  /** GAS版 Script Properties AUTH_SALT と同じ値。移行済みスタッフのログインにのみ使う。 */
  legacyAuthSalt?: string;
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
    customers: new DrizzleCustomerRepository(db),
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
    maps: gasBridgeOptions ? new GasBridgeMapsPort(gasBridgeOptions) : new NoopMapsPort(),
    schedule: gasBridgeOptions ? new GasBridgeSchedulePort(gasBridgeOptions) : new NoopSchedulePort(),
    mirror: env.MIRROR_TO_GOOGLE_SHEETS ? new DrizzleOutboxRepository(db) : new NoopMirrorPort(),
    legacyAuthSalt: env.LEGACY_AUTH_SALT,
  };
}
