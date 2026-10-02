import {
  emptyToUndefined,
  parseEnvOrThrow,
  sharedEnvProblems,
  sharedEnvShape,
  vapidEnvProblems,
  vapidSenderEnvShape,
} from '@katahimo/integrations';
import { z } from 'zod';

/**
 * ワーカー(Cloud Run Jobs: outbox-drain・夜間のカレンダー反映・翌日の予定のお知らせ・顧客CSV取込・保守。
 * ローカル開発の pnpm worker も同じ)の環境変数。
 * API と同じでなければならない変数は sharedEnvShape(@katahimo/integrations)。
 */
const envSchema = z.object({
  ...sharedEnvShape,
  // ワーカー専用の DB ユーザー(katahimo_worker。テナントを横断して outbox を取るポリシーがある)。
  // API の DATABASE_URL(katahimo_app)とは別のユーザー・パスワード(Secret Manager の別の secret)。
  WORKER_DATABASE_URL: z.string().min(1, 'WORKER_DATABASE_URL が必要です(katahimo_worker の接続)'),

  // パスワード再設定メール(outbox の mail.password_reset)の送信。未設定の開発環境では内容を標準出力に出す。
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASS: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_FROM: z.string().default('保育日報 <noreply@localhost>'),
  // STARTTLS(SMTP_PORT が 465 以外)で TLS への切り替えを必須にするか(既定 true。TLS 1.2 以上)。false は TLS の無い
  // 開発用の SMTP(Mailpit 等)だけで、本番(NODE_ENV=production)では起動時に断る(途中で STARTTLS を消されると平文で流れるため)。
  SMTP_REQUIRE_TLS: z
    .preprocess(emptyToUndefined, z.enum(['true', 'false', '1', '0']).optional())
    .transform((value) => value === undefined || value === 'true' || value === '1'),
  // 画面の URL(例: https://app.example.jp)。管理者が送る「パスワード設定の案内」のメールに、法人IDつきの
  // ログイン画面の URL として書く(未設定なら URL は書かず、法人IDだけを書く)。
  APP_PUBLIC_URL: z.preprocess(
    emptyToUndefined,
    z.string().url('APP_PUBLIC_URL は URL で指定してください').optional(),
  ),

  // Web Push(翌日の予定のお知らせ・テスト通知)の送信: VAPID の秘密鍵と連絡先。公開鍵(VAPID_PUBLIC_KEY)と
  // 3つとも設定するか、3つとも空にする(空なら push.* は送らずに完了にし、お知らせのジョブは何もしない)。
  ...vapidSenderEnvShape,

  // job:sync-busy-blocks が同期する期間(今日から何日先まで)。
  BUSY_BLOCK_SYNC_DAYS: z.coerce.number().int().positive().default(28),

  // ── outbox ──
  // 1回の実行(outbox-drain・バッチのジョブの最後)で続けて処理する最大件数(1件ずつ取り出す)。残りは次の実行が処理する。
  OUTBOX_DRAIN_MAX: z.coerce.number().int().positive().default(500),
  // ローカル開発の pnpm worker だけ: 空になった後、次に見に行くまでの間隔。
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // 取り出したメッセージのリース。1件の処理(GAS Bridge の呼び出し等)の最長時間より長くする。
  OUTBOX_LEASE_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 60_000),
  // 再試行の間隔: 初回の待ち時間(以後倍々)と上限。試行回数の上限はメッセージごと(max_attempts)。
  OUTBOX_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().default(30_000),
  OUTBOX_RETRY_MAX_DELAY_MS: z.coerce.number().int().positive().default(3_600_000),

  // 停止の合図(SIGTERM)から、処理中のものを諦めて終えるまでの時間(Cloud Run Jobs は約10秒で強制終了する)。
  WORKER_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
  // 1回だけ実行するジョブ(Cloud Run Jobs)の上限時間。超えたら失敗として終える。
  JOB_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 60_000),

  // 操作ログ(app_logs)を残す月数(月のパーティションごと消す)。
  APP_LOG_RETENTION_MONTHS: z.coerce.number().int().min(1).default(13),
});

export type WorkerEnv = z.infer<typeof envSchema>;

function checkCombinations(env: WorkerEnv): string[] {
  const problems = [...sharedEnvProblems(env), ...vapidEnvProblems(env)];
  if (env.NODE_ENV === 'production' && !env.SMTP_HOST) {
    problems.push('  - SMTP_HOST: 本番ではパスワード再設定メールの送信にSMTP設定が必要です');
  }
  if (env.NODE_ENV === 'production' && !env.SMTP_REQUIRE_TLS) {
    problems.push(
      '  - SMTP_REQUIRE_TLS: 本番では false にできません(STARTTLS を必須にし、再設定コードを平文で送らない)',
    );
  }
  return problems;
}

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return parseEnvOrThrow(envSchema, source, checkCombinations);
}
