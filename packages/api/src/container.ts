import type {
  AppLogPort,
  CustomerCsvSourcePort,
  MapsPort,
  NotifierPort,
  RateLimiterPort,
  ReportAiPort,
  ReportAiPortFactory,
  SchedulePort,
  SecretBoxPort,
  StoragePort,
  TenantDirectoryPort,
  UnitOfWorkPort,
} from '@katahimo/core/ports';
import type { PasswordHasherPort, RateLimitPolicy } from '@katahimo/core/usecases';
import {
  createScheduleDirectory,
  DEFAULT_RATE_LIMIT_POLICY,
  OutboxDrainNotifier,
  readTenantSecret,
  withOutboxDrainTrigger,
  withRateLimitCounts,
} from '@katahimo/core/usecases';
import type { Database } from '@katahimo/db';
import { DrizzleUnitOfWork } from '@katahimo/db';
import {
  DrizzleAppLogRepository,
  DrizzleRateLimiter,
  DrizzleTenantDirectory,
} from '@katahimo/db/repositories';
import {
  createCustomerCsvSource,
  createOutboxDrainTrigger,
  createScheduleServices,
  createSecretBox,
  createStoragePort,
  GeminiAiPort,
  InMemoryTtlCache,
  listAvailableGeminiModels,
  NoopReportAiPort,
  outboxTopicPolicyOf,
  type ScheduleProvider,
  WebhookNotifierPort,
} from '@katahimo/integrations';
import { sql } from 'drizzle-orm';
import { argon2PasswordHasher } from './authAdapters';
import type { Env } from './env';
import { DemoTenant } from './http/demoRestrictions';
import { writeStructuredLog } from './http/requestLog';
import { deriveSecret } from './secrets';

/**
 * ルートハンドラに配る依存一式(ポートの型だけで持つ)。usecase(@katahimo/core)の Deps を構造的に満たすため、
 * そのまま渡せる。DB への読み書きは全て uow(テナントのトランザクション)を通す。
 */
export interface Container {
  uow: UnitOfWorkPort;
  /** outbox-drain の起動の依頼(積んだ操作の後は uow が頼む。再設定コードの要求は積まなくても頼み、応答時間を揃える)。 */
  outboxDrain: { notify(): Promise<void> };
  tenants: TenantDirectoryPort;
  appLog: AppLogPort;
  /** テナントの秘密値(tenant_secrets)の封と開封(本番は Cloud KMS)。 */
  secretBox: SecretBoxPort;
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
  /** AI 生成の記録に残すアプリの版(Cloud Run のリビジョン)。 */
  appVersion: string | null;
  listGeminiModels: typeof listAvailableGeminiModels;
  /** 「今日/明日の予定」(SCHEDULE_PROVIDER で Google / GAS Bridge / Noop を切り替える)。 */
  schedule: SchedulePort;
  scheduleProvider: ScheduleProvider;
  /** スタッフの自宅住所のジオコーディング(SCHEDULE_PROVIDER=google だけ。それ以外は住所だけを保存する)。 */
  maps?: MapsPort;
  /** 顧客CSVの取込元(Google Drive / ローカルディレクトリ)。管理者の手動取込で使う。 */
  csvSource: CustomerCsvSourcePort;
  /** Web Push の VAPID の公開鍵(VAPID_PUBLIC_KEY)。null なら通知は使えない。 */
  pushPublicKey: string | null;
  /** GAS版 Script Properties AUTH_SALT と同じ値。移行したスタッフの初回ログインにだけ使う。 */
  legacyAuthSalt?: string;
  /** DB の疎通確認(GET /api/health/db)。 */
  pingDatabase(): Promise<void>;
  config: {
    /** セッション Cookie の Secure 属性・HSTS に使う。 */
    isProduction: boolean;
  };
  /** 公開デモ用テナント(DEMO_TENANT_SLUG)の判定。null ならデモの制限は無い(http/demoRestrictions.ts)。 */
  demo: DemoTenant | null;
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
 * API の Unit of Work と outbox-drain の起動の依頼。OUTBOX_DRAIN_JOB があれば、outbox に積んだトランザクションの
 * コミットの後に outbox-drain の実行を頼む(インスタンスごとに5秒に1回まで。失敗は WARN にして見回りに任せる)。
 * 無ければ頼まない(ローカル開発)。
 */
function createUnitOfWork(env: Env, db: Database): Pick<Container, 'uow' | 'outboxDrain'> {
  const uow = new DrizzleUnitOfWork(db, { outboxPolicy: outboxTopicPolicyOf(env) });
  const trigger = createOutboxDrainTrigger(env);
  if (!trigger) return { uow, outboxDrain: { notify: async () => {} } };
  const notifier = new OutboxDrainNotifier({
    trigger,
    warn: (failure) => writeStructuredLog({ severity: 'WARNING', ...failure }),
  });
  return { uow: withOutboxDrainTrigger(uow, notifier), outboxDrain: notifier };
}

export function createContainer(env: Env, db: Database): Container {
  const { uow, outboxDrain } = createUnitOfWork(env, db);
  const secretBox = createSecretBox(env);
  const appLog = new DrizzleAppLogRepository(db);
  const tenants = new DrizzleTenantDirectory(db);
  const scheduleServices = createScheduleServices(env, {
    directory: createScheduleDirectory({
      uow,
      // 顧客・スタッフのマスタ(テナント × 顧客データの版数)。顧客CSVの取込で版数が変わると読み直す
      cache: new InMemoryTtlCache({ maxEntries: 200 }),
    }),
    appLog,
    // 区間ごとのルート・住所ごとのジオコーディング結果の共有キャッシュ(閲覧用。予定そのものは毎回カレンダーから読む)。
    // プロセス内のため Cloud Run のインスタンス間では共有しない
    mapsCache: new InMemoryTtlCache({ maxEntries: 5000 }),
    tenants,
  });
  console.info(`予定・ルート計算の実装: ${scheduleServices.provider}`);

  const webhookFallback = { report: env.GCHAT_REPORT_WEBHOOK_URL, receipt: env.GCHAT_RECEIPT_WEBHOOK_URL };
  return {
    uow,
    outboxDrain,
    tenants,
    appLog,
    secretBox,
    passwordHasher: argon2PasswordHasher,
    storage: createStoragePort(env),
    notifier: new WebhookNotifierPort({
      // テナントが管理者設定で保存した URL(tenant_secrets)を優先し、無い・開けない・読めないときは .env の既定
      async resolve(tenantId, channel) {
        const name = channel === 'report' ? 'gchat_report_webhook' : 'gchat_receipt_webhook';
        try {
          const saved = await readTenantSecret({ uow, secretBox, appLog }, tenantId, name);
          return saved || webhookFallback[channel];
        } catch {
          return webhookFallback[channel];
        }
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
    appVersion: env.K_REVISION ?? null,
    listGeminiModels: listAvailableGeminiModels,
    schedule: scheduleServices.schedule,
    scheduleProvider: scheduleServices.provider,
    ...(scheduleServices.maps ? { maps: scheduleServices.maps } : {}),
    csvSource: createCustomerCsvSource({
      ...(env.CUSTOMER_CSV_LOCAL_DIR ? { localDir: env.CUSTOMER_CSV_LOCAL_DIR } : {}),
    }),
    pushPublicKey: env.VAPID_PUBLIC_KEY ?? null,
    ...(env.LEGACY_AUTH_SALT ? { legacyAuthSalt: env.LEGACY_AUTH_SALT } : {}),
    async pingDatabase() {
      await db.execute(sql`SELECT 1`);
    },
    config: { isProduction: env.NODE_ENV === 'production' },
    demo: env.DEMO_TENANT_SLUG ? new DemoTenant(env.DEMO_TENANT_SLUG, tenants) : null,
  };
}
