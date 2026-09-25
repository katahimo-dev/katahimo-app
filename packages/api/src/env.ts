import {
  emptyToUndefined,
  optionalPositiveInt,
  parseEnvOrThrow,
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

  // ブラインドインデックス(領収書の重複判定)のマスター鍵。32バイト(64桁hex)。テナント・用途ごとの鍵は
  // HKDF で導出する。データの暗号化鍵(KEK/DEK)とは別の値にすること。値を変えると既存のインデックスが引けなくなる。
  BLIND_INDEX_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'BLIND_INDEX_MASTER_KEY は32バイト(64桁の16進数)にしてください'),

  // 移行期のみ必要: GAS版 Script Properties の AUTH_SALT と同じ値(GAS版のパスワードのままのログインに使う)。
  LEGACY_AUTH_SALT: z.preprocess(emptyToUndefined, z.string().optional()),

  GEMINI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_MODEL_REPORT: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_MODEL_OCR: z.preprocess(emptyToUndefined, z.string().optional()),

  // Google Chat Incoming Webhook の既定(テナントが管理者設定で保存していない場合)。未設定なら通知しない。
  GCHAT_REPORT_WEBHOOK_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  GCHAT_RECEIPT_WEBHOOK_URL: z.preprocess(emptyToUndefined, z.string().optional()),

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
  RATE_LIMIT_SCHEDULE_REFRESH_PER_STAFF_HOUR: optionalPositiveInt,
});

export type Env = z.infer<typeof envSchema>;

/** X-Forwarded-For の信頼する段数(未指定なら本番1・それ以外0)。 */
export function trustedProxyHops(env: Pick<Env, 'NODE_ENV' | 'TRUSTED_PROXY_HOPS'>): number {
  return env.TRUSTED_PROXY_HOPS ?? (env.NODE_ENV === 'production' ? 1 : 0);
}

function checkCombinations(env: Env): string[] {
  const problems = sharedEnvProblems(env);
  if (
    env.NODE_ENV === 'production' &&
    (env.SESSION_SECRET.length < 32 || env.SESSION_SECRET === 'change-me-in-production')
  ) {
    problems.push('  - SESSION_SECRET: 本番は32文字以上のランダムな値にしてください(openssl rand -hex 32)');
  }
  return problems;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parseEnvOrThrow(envSchema, source, checkCombinations);
}
