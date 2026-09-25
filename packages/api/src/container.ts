import type {
  AppLogPort,
  AuditLogPort,
  BlindIndexPort,
  CryptoPort,
  CustomerCsvSourcePort,
  NotifierPort,
  RateLimiterPort,
  ReportAiPort,
  ReportAiPortFactory,
  SchedulePort,
  StoragePort,
  TenantDirectoryPort,
  UnitOfWorkPort,
} from '@katahimo/core/ports';
import type { PasswordHasherPort, RateLimitPolicy } from '@katahimo/core/usecases';
import {
  createScheduleDirectory,
  DEFAULT_RATE_LIMIT_POLICY,
  readTenantSecret,
  withRateLimitCounts,
} from '@katahimo/core/usecases';
import type { Database } from '@katahimo/db';
import { DrizzleUnitOfWork } from '@katahimo/db';
import {
  DrizzleAppLogRepository,
  DrizzleRateLimiter,
  DrizzleTenantDataKeyReader,
  DrizzleTenantDirectory,
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
  NoopReportAiPort,
  type ScheduleProvider,
  skippedOutboxTopics,
  WebhookNotifierPort,
} from '@katahimo/integrations';
import { sql } from 'drizzle-orm';
import { argon2PasswordHasher } from './authAdapters';
import type { Env } from './env';
import { deriveSecret } from './secrets';

/**
 * ルートハンドラに配る依存一式(ポートの型だけで持つ)。usecase(@katahimo/core)の Deps を構造的に満たすため、
 * そのまま渡せる。DB への読み書きは全て uow(テナントのトランザクション)を通す。
 */
export interface Container {
  uow: UnitOfWorkPort;
  tenants: TenantDirectoryPort;
  appLog: AppLogPort;
  audit: AuditLogPort;
  crypto: CryptoPort;
  blindIndex: BlindIndexPort;
  passwordHasher: PasswordHasherPort;
  storage: StoragePort;
  notifier: NotifierPort;
  /** 再設定コードの HMAC 鍵(SESSION_SECRET から HKDF で導出した専用の鍵)。 */
  resetCodeSecret: string;
  /** ログイン・パスワード再設定・AI生成等の回数制限(rate_limit_buckets、インスタンス間で共有)。 */
  rateLimiter: RateLimiterPort;
  rateLimits: RateLimitPolicy;
  /** テナントが独自の Gemini API キーを設定していない場合のフォールバック(.env の設定か Noop)。 */
  reportAi: ReportAiPort;
  reportAiFactory: ReportAiPortFactory;
  listGeminiModels: typeof listAvailableGeminiModels;
  /** 「今日/明日の予定」(SCHEDULE_PROVIDER で Google / GAS Bridge / Noop を切り替える)。 */
  schedule: SchedulePort;
  scheduleProvider: ScheduleProvider;
  /** 顧客CSVの取込元(Google Drive / ローカルディレクトリ)。管理者の手動取込で使う。 */
  csvSource: CustomerCsvSourcePort;
  /** GAS版 Script Properties AUTH_SALT と同じ値。移行したスタッフの初回ログインにだけ使う。 */
  legacyAuthSalt?: string;
  /** DB の疎通確認(GET /api/health/db)。 */
  pingDatabase(): Promise<void>;
  config: {
    /** セッション Cookie の Secure 属性・HSTS に使う。 */
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

/**
 * keyDb はテナントの鍵(tenant_data_keys)の読み込み専用の小さなプール(省略時は db)。サーバーは専用のプールを
 * 渡す(トランザクションの途中で鍵の読み直しが要っても、db のプールの空きを待ち合って詰まらないように)。
 */
export function createContainer(env: Env, db: Database, keyDb: Database = db): Container {
  const crypto = new LocalCryptoPort(new DrizzleTenantDataKeyReader(keyDb), createKeyManagementPort(env));
  const uow = new DrizzleUnitOfWork(db, { skipOutboxTopics: skippedOutboxTopics(env), crypto });
  const audit = new ConsoleAuditLogPort();
  const appLog = new DrizzleAppLogRepository(db);
  const scheduleServices = createScheduleServices(env, {
    directory: createScheduleDirectory({
      uow,
      crypto,
      audit,
      // 顧客・スタッフのマスタ(テナント × 顧客データの版数)。顧客CSVの取込で版数が変わると読み直す
      cache: new InMemoryTtlCache({ maxEntries: 200 }),
    }),
    appLog,
    // ルート結果の共有キャッシュ(GAS版 CacheService 相当。プロセス内のため Cloud Run のインスタンス間では共有しない)
    routeCache: new InMemoryTtlCache({ maxEntries: 2000 }),
  });
  console.info(`予定・ルート計算の実装: ${scheduleServices.provider}`);

  const webhookFallback = { report: env.GCHAT_REPORT_WEBHOOK_URL, receipt: env.GCHAT_RECEIPT_WEBHOOK_URL };
  return {
    uow,
    tenants: new DrizzleTenantDirectory(db),
    appLog,
    audit,
    crypto,
    blindIndex: new LocalBlindIndexPort(env.BLIND_INDEX_MASTER_KEY),
    passwordHasher: argon2PasswordHasher,
    storage: createStoragePort(env),
    notifier: new WebhookNotifierPort({
      // テナントが管理者設定で保存した URL(tenant_secrets)を優先し、無ければ .env の既定
      async resolve(tenantId, channel) {
        const name = channel === 'report' ? 'gchat_report_webhook' : 'gchat_receipt_webhook';
        const saved = await uow.run(tenantId, (r) => readTenantSecret(crypto, r, name));
        return saved || webhookFallback[channel];
      },
    }),
    resetCodeSecret: deriveSecret(env.SESSION_SECRET, 'katahimo/password-reset-code/v1'),
    rateLimiter: new DrizzleRateLimiter(db, deriveSecret(env.SESSION_SECRET, 'katahimo/rate-limit-key/v1')),
    rateLimits: rateLimitPolicyOf(env),
    reportAi: env.GEMINI_API_KEY
      ? new GeminiAiPort({
          apiKey: env.GEMINI_API_KEY,
          ...(env.GEMINI_MODEL_REPORT ? { reportModel: env.GEMINI_MODEL_REPORT } : {}),
          ...(env.GEMINI_MODEL_OCR ? { ocrModel: env.GEMINI_MODEL_OCR } : {}),
        })
      : new NoopReportAiPort(),
    reportAiFactory: { create: (options) => new GeminiAiPort(options) },
    listGeminiModels: listAvailableGeminiModels,
    schedule: scheduleServices.schedule,
    scheduleProvider: scheduleServices.provider,
    csvSource: createCustomerCsvSource({
      driveFolderIdsByTenantSlug: env.CUSTOMER_CSV_DRIVE_FOLDERS,
      ...(env.CUSTOMER_CSV_LOCAL_DIR ? { localDir: env.CUSTOMER_CSV_LOCAL_DIR } : {}),
    }),
    ...(env.LEGACY_AUTH_SALT ? { legacyAuthSalt: env.LEGACY_AUTH_SALT } : {}),
    async pingDatabase() {
      await db.execute(sql`SELECT 1`);
    },
    config: { isProduction: env.NODE_ENV === 'production' },
  };
}
