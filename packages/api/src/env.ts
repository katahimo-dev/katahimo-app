import {
  booleanFlag,
  CLOUD_RUN_JOB_NAME_PATTERN,
  emptyToUndefined,
  optionalPositiveInt,
  parseEnvOrThrow,
  SECRET_BOX_PROVIDERS,
  secretBoxEnvProblems,
  sharedEnvProblems,
  sharedEnvShape,
} from '@katahimo/integrations';
import { z } from 'zod';

/**
 * API サーバーの環境変数。起動時に一度だけ検証し、足りない設定は起動前に落とす(GAS版は Script Properties の
 * 未設定に実行時まで気づけなかった)。ワーカーと同じでなければならない変数は sharedEnvShape(@katahimo/integrations)。
 */
const envSchema = z.object({
  ...sharedEnvShape,
  PORT: z.coerce.number().int().positive().default(8080),
  // アプリ用の DB ユーザー(katahimo_app。RLS の対象、DDL の権限なし)。
  DATABASE_URL: z.string().min(1, 'DATABASE_URL が必要です'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET は16文字以上にしてください'),

  // ビルド済み Web 画面(packages/web の dist)を同じサービスから配信する場合のディレクトリ(本番コンテナ)。
  WEB_DIST_DIR: z.preprocess(emptyToUndefined, z.string().optional()),

  // テナントの秘密値(Gemini API キー・Google Chat の Webhook URL)の封に使う鍵。local: SECRET_BOX_LOCAL_KEY
  // (開発用、32バイト=64桁hex) / gcp: Cloud KMS の鍵 SECRET_BOX_KMS_KEY(本番は必須)。
  SECRET_BOX_PROVIDER: z.preprocess(emptyToUndefined, z.enum(SECRET_BOX_PROVIDERS).default('local')),
  SECRET_BOX_LOCAL_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'SECRET_BOX_LOCAL_KEY は32バイト(64桁の16進数)にしてください')
      .optional(),
  ),
  SECRET_BOX_KMS_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

  // 移行期のみ必要: GAS版 Script Properties の AUTH_SALT と同じ値(GAS版のパスワードのままのログインに使う)。
  LEGACY_AUTH_SALT: z.preprocess(emptyToUndefined, z.string().optional()),

  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Cloud Run が付けるリビジョン名(AI 生成の記録にアプリの版として残す。ローカルは未設定)。 */
  K_REVISION: z.preprocess(emptyToUndefined, z.string().max(200).optional()),

  // Google Chat Incoming Webhook の既定(テナントが管理者設定で保存していない場合)。未設定なら通知しない。
  GCHAT_REPORT_WEBHOOK_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  GCHAT_RECEIPT_WEBHOOK_URL: z.preprocess(emptyToUndefined, z.string().optional()),

  // outbox を処理する Cloud Run のジョブ(projects/<p>/locations/<r>/jobs/katahimo-outbox-drain)。outbox に積んだ操作の
  // コミットの後に Cloud Run Admin API の jobs.run で1回の実行を頼む(doc/05_バッチ・外部連携.md 2章)。本番は必須。
  // 未設定(ローカル開発)なら頼まず、outbox は pnpm worker(ローカル専用の見回り)か pnpm outbox:once で処理する。
  OUTBOX_DRAIN_JOB: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(
        CLOUD_RUN_JOB_NAME_PATTERN,
        'OUTBOX_DRAIN_JOB は projects/<プロジェクト>/locations/<リージョン>/jobs/<ジョブ> の形式で指定してください',
      )
      .optional(),
  ),

  // 公開デモ用のテナントの slug(このテナントだけ、他の訪問者を妨げる操作を断り、AI の回数を1回のログインで
  // 10回までにする。http/demoRestrictions.ts、doc/07 の「公開デモ」)。未設定ならデモの制限は無く、
  // GET /api/demo/config は enabled: false を返す。
  DEMO_TENANT_SLUG: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
        'DEMO_TENANT_SLUG はテナントの slug(英小文字・数字・ハイフン)にしてください',
      )
      .optional(),
  ),

  // デモ専用の環境か(true / 1)。true ならログイン画面にデモ用アカウントとパスワードを出す(GET /api/demo/config)。
  // 本番の環境に暫定でデモ用テナントを置くときは false のまま(本番の利用者に出さない)。DEMO_TENANT_SLUG が必要。
  DEMO_PUBLIC_LOGIN: booleanFlag,
  // 訪問者の入力を残す日数(demo:reset が日付付きの slug で残した過去のデモ用テナントを、この日数を過ぎたら消す)。
  // ログイン画面の案内にも出す。API と demo:reset のジョブで同じ値にする。未設定ならデモ専用の環境(DEMO_PUBLIC_LOGIN=true)は
  // 30、それ以外(本番の環境に暫定でデモ用テナントを置く。作り直しのジョブが無い)は null(画面は期間を約束しない)。
  // demo:reset は未設定なら 30 で消す(demoResetRetentionDays)。
  DEMO_DATA_RETENTION_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(3650).optional(),
  ),
  // 操作ログ・接続情報(IPアドレス等)を残す月数の案内(ログイン画面に出す値)。実際に消すのはワーカーの保守ジョブ
  // (APP_LOG_RETENTION_MONTHS)なので同じ値にする。未設定ならデモ専用の環境は 3、それ以外は null(本番の操作ログは
  // 本番の保存期間に従うため、明示して設定したときだけ出す)。
  DEMO_LOG_RETENTION_MONTHS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(120).optional(),
  ),

  // X-Forwarded-For の右から何番目を送信元IPとみなすか(信頼できるプロキシの段数)。Cloud Run 直は1、
  // 外部ロードバランサを前に置く場合は2、0なら接続元のアドレス。未指定は本番1・それ以外0。
  TRUSTED_PROXY_HOPS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(5).optional()),

  // レート制限の回数(packages/core/src/usecases/rateLimits.ts。未指定は既定値。窓の長さは固定)。
  RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT: optionalPositiveInt,
  RATE_LIMIT_LOGIN_FAILURES_PER_IP: optionalPositiveInt,
  RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_ACCOUNT: optionalPositiveInt,
  RATE_LIMIT_PASSWORD_RESET_REQUESTS_PER_IP: optionalPositiveInt,
  RATE_LIMIT_AI_GENERATE_PER_STAFF_DAY: optionalPositiveInt,
  RATE_LIMIT_RECEIPT_OCR_PER_STAFF_DAY: optionalPositiveInt,
  RATE_LIMIT_RECEIPT_UPLOAD_PER_STAFF_HOUR: optionalPositiveInt,
  RATE_LIMIT_SCHEDULE_REFRESH_PER_STAFF_HOUR: optionalPositiveInt,
});

/** デモ専用の環境(DEMO_PUBLIC_LOGIN=true)で DEMO_DATA_RETENTION_DAYS が未設定のときの日数(demo:reset も同じ)。 */
export const DEFAULT_DEMO_DATA_RETENTION_DAYS = 30;
/** デモ専用の環境で DEMO_LOG_RETENTION_MONTHS が未設定のときの月数(デモのワーカーの APP_LOG_RETENTION_MONTHS と揃える)。 */
export const DEFAULT_DEMO_LOG_RETENTION_MONTHS = 3;

type ParsedEnv = z.infer<typeof envSchema>;

/**
 * 公開デモの保存期間の案内(GET /api/demo/config)は、デモ専用の環境なら未設定でも既定値、それ以外は明示したときだけ
 * (本番の環境に暫定でデモ用テナントを置くときに、守っていない期間を約束しない)。null = 期間を約束しない。
 */
export type Env = Omit<ParsedEnv, 'DEMO_DATA_RETENTION_DAYS' | 'DEMO_LOG_RETENTION_MONTHS'> & {
  DEMO_DATA_RETENTION_DAYS: number | null;
  DEMO_LOG_RETENTION_MONTHS: number | null;
};

function withDemoRetentionDefaults(env: ParsedEnv): Env {
  const publicDemo = env.DEMO_PUBLIC_LOGIN;
  return {
    ...env,
    DEMO_DATA_RETENTION_DAYS:
      env.DEMO_DATA_RETENTION_DAYS ?? (publicDemo ? DEFAULT_DEMO_DATA_RETENTION_DAYS : null),
    DEMO_LOG_RETENTION_MONTHS:
      env.DEMO_LOG_RETENTION_MONTHS ?? (publicDemo ? DEFAULT_DEMO_LOG_RETENTION_MONTHS : null),
  };
}

/** demo:reset が過去のデモ用テナントを消すまでの日数(未設定なら DEFAULT_DEMO_DATA_RETENTION_DAYS)。 */
export function demoResetRetentionDays(env: Pick<Env, 'DEMO_DATA_RETENTION_DAYS'>): number {
  return env.DEMO_DATA_RETENTION_DAYS ?? DEFAULT_DEMO_DATA_RETENTION_DAYS;
}

/** X-Forwarded-For の信頼する段数(未指定なら本番1・それ以外0)。 */
export function trustedProxyHops(env: Pick<Env, 'NODE_ENV' | 'TRUSTED_PROXY_HOPS'>): number {
  return env.TRUSTED_PROXY_HOPS ?? (env.NODE_ENV === 'production' ? 1 : 0);
}

function checkCombinations(env: ParsedEnv): string[] {
  const problems = [...sharedEnvProblems(env), ...secretBoxEnvProblems(env, env.NODE_ENV === 'production')];
  if (
    env.NODE_ENV === 'production' &&
    (env.SESSION_SECRET.length < 32 || env.SESSION_SECRET === 'change-me-in-production')
  ) {
    problems.push('  - SESSION_SECRET: 本番は32文字以上のランダムな値にしてください(openssl rand -hex 32)');
  }
  if (env.DEMO_PUBLIC_LOGIN && !env.DEMO_TENANT_SLUG) {
    problems.push(
      '  - DEMO_PUBLIC_LOGIN: デモ用アカウントをログイン画面に出すには、デモ用テナントの DEMO_TENANT_SLUG も必要です',
    );
  }
  if (env.NODE_ENV === 'production' && !env.OUTBOX_DRAIN_JOB) {
    problems.push(
      '  - OUTBOX_DRAIN_JOB: 本番では outbox(再設定メール・Web Push・ミラー)をすぐに送るため、outbox-drain のジョブ名が必要です',
    );
  }
  return problems;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return withDemoRetentionDefaults(parseEnvOrThrow(envSchema, source, checkCombinations));
}
