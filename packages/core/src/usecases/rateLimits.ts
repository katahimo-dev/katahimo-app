import type { RateLimitDecision, RateLimitRule } from '../domain/rateLimit';
import type { AppLogPort } from '../ports/appLog';
import type { RateLimiterPort } from '../ports/rateLimiter';
import type { RequestMeta } from './requestMeta';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * レート制限の規則一式。既定値は DEFAULT_RATE_LIMIT_POLICY、回数は環境変数で変えられる
 * (packages/api/src/env.ts の RATE_LIMIT_*)。窓・ロック時間は固定。
 */
export interface RateLimitPolicy {
  /** ログイン失敗(テナントslug+ログインID単位)。上限で一時ロック。 */
  loginFailureAccount: RateLimitRule;
  /** ログイン失敗(送信元IP単位)。複数アカウントへの総当たり(パスワードスプレー)対策。 */
  loginFailureIp: RateLimitRule;
  /** パスワード再設定コードの発行要求(アカウント単位)。メール爆撃・有効なコードの無効化の繰り返し対策。 */
  passwordResetRequestAccount: RateLimitRule;
  /** パスワード再設定コードの発行要求(送信元IP単位)。 */
  passwordResetRequestIp: RateLimitRule;
  /** パスワード再設定コードの確認(アカウント単位。コードを発行し直しながらの総当たり対策)。 */
  passwordResetConfirmAccount: RateLimitRule;
  /** パスワード再設定コードの確認(送信元IP単位)。 */
  passwordResetConfirmIp: RateLimitRule;
  /** 日報・事故報告のAI生成(スタッフ単位の1日の上限。Gemini の従量課金対策)。 */
  aiGenerateStaff: RateLimitRule;
  /** 領収書OCR(スタッフ単位の1日の上限)。 */
  receiptOcrStaff: RateLimitRule;
  /**
   * 領収書の画像の登録(POST /api/receipts。スタッフ単位の1時間の上限)。1回で最大6枚・14MB までの本文を受け取り、
   * 画像を保存先(GCS)に書くため、送り続けで保存先・CPU を使い切らせない。数えるのは登録の要求の回数(枚数ではない)。
   */
  receiptUploadStaff: RateLimitRule;
  /** 予定の「ルート再計算」(forceRefresh、スタッフ単位の1時間の上限。Maps の従量課金対策)。 */
  scheduleForceRefreshStaff: RateLimitRule;
  /** 設定画面の「テスト通知を送る」(スタッフ単位の1時間の上限)。 */
  pushTestStaff: RateLimitRule;
  /** 通知の購読の登録(スタッフ単位の1時間の上限。購読の数は別に1人10件まで)。 */
  pushSubscribeStaff: RateLimitRule;
  /** 外部システムからの顧客の受け取り(API キー単位の1時間の上限。1回500件まで)。 */
  integrationCustomersKey: RateLimitRule;
  /**
   * 外部連携の API キーの認証の失敗(送信元IP単位)。上限で一時ロックし、ロック中は認証(DB)もログも行わずに 429。
   * 誤ったキーの総当たり・壊れた連携先の送り続けで操作ログが溢れないように。
   */
  integrationAuthFailureIp: RateLimitRule;
  /** 出勤簿の Excel の書き出し(1人分・全員分とも。スタッフ単位の1時間の上限。全員分は重いため)。 */
  attendanceExportStaff: RateLimitRule;
  /**
   * スタッフの xlsx の取込の反映(dryRun = false。管理者単位の10分の上限)。反映は1回で最大500人を書き、
   * 自宅住所の変わる行ごとに地図API(従量課金)を呼ぶため。確かめる(dryRun)だけは数えない。
   */
  staffImportApplyStaff: RateLimitRule;
  /**
   * Gemini API キーの保存(管理者単位の1時間の上限)。保存ごとに Gemini へ確かめの問い合わせをするため
   * (公開デモでは誰でも管理者でログインできる)。
   */
  geminiKeySaveStaff: RateLimitRule;
  /**
   * 顧客CSVの手動の取込(コーディネーター・管理者単位の1時間の上限)。押すたびに Drive のフォルダを読み、新しい版が
   * あれば取り込むため、押し続けで取込を詰まらせない。
   */
  customerCsvImportStaff: RateLimitRule;
}

export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = {
  loginFailureAccount: {
    name: 'login_failure_account',
    limit: 10,
    windowMs: 15 * MINUTE_MS,
    lockMs: 15 * MINUTE_MS,
  },
  loginFailureIp: { name: 'login_failure_ip', limit: 50, windowMs: 15 * MINUTE_MS, lockMs: 15 * MINUTE_MS },
  passwordResetRequestAccount: { name: 'password_reset_request_account', limit: 5, windowMs: HOUR_MS },
  passwordResetRequestIp: { name: 'password_reset_request_ip', limit: 20, windowMs: HOUR_MS },
  passwordResetConfirmAccount: { name: 'password_reset_confirm_account', limit: 20, windowMs: HOUR_MS },
  passwordResetConfirmIp: { name: 'password_reset_confirm_ip', limit: 50, windowMs: HOUR_MS },
  aiGenerateStaff: { name: 'ai_generate_staff', limit: 200, windowMs: DAY_MS },
  receiptOcrStaff: { name: 'receipt_ocr_staff', limit: 300, windowMs: DAY_MS },
  receiptUploadStaff: { name: 'receipt_upload_staff', limit: 60, windowMs: HOUR_MS },
  scheduleForceRefreshStaff: { name: 'schedule_force_refresh_staff', limit: 30, windowMs: HOUR_MS },
  pushTestStaff: { name: 'push_test_staff', limit: 10, windowMs: HOUR_MS },
  pushSubscribeStaff: { name: 'push_subscribe_staff', limit: 30, windowMs: HOUR_MS },
  integrationCustomersKey: { name: 'integration_customers_key', limit: 120, windowMs: HOUR_MS },
  integrationAuthFailureIp: {
    name: 'integration_auth_failure_ip',
    limit: 30,
    windowMs: 15 * MINUTE_MS,
    lockMs: 15 * MINUTE_MS,
  },
  attendanceExportStaff: { name: 'attendance_export_staff', limit: 30, windowMs: HOUR_MS },
  staffImportApplyStaff: { name: 'staff_import_apply_staff', limit: 5, windowMs: 10 * MINUTE_MS },
  geminiKeySaveStaff: { name: 'gemini_key_save_staff', limit: 20, windowMs: HOUR_MS },
  customerCsvImportStaff: { name: 'customer_csv_import_staff', limit: 30, windowMs: HOUR_MS },
};

/** 回数だけを差し替えた規則一式を作る(環境変数での調整用。0以下・未指定は既定値のまま)。 */
export function withRateLimitCounts(
  base: RateLimitPolicy,
  counts: Partial<Record<keyof RateLimitPolicy, number | undefined>>,
): RateLimitPolicy {
  const result = { ...base };
  for (const key of Object.keys(counts) as (keyof RateLimitPolicy)[]) {
    const limit = counts[key];
    if (limit !== undefined && limit > 0) result[key] = { ...base[key], limit };
  }
  return result;
}

/** アカウント単位の規則のキー。アカウントの有無にかかわらず入力値から作る(存在の有無を漏らさないため)。 */
export function accountRateLimitKey(tenantSlug: string, normalizedLoginId: string): string {
  return `${tenantSlug.trim().toLowerCase()}:${normalizedLoginId}`;
}

export interface RateLimitDeps {
  rateLimiter: RateLimiterPort;
  rateLimits: RateLimitPolicy;
  appLog: AppLogPort;
}

export interface QuotaContext {
  tenantId: string | null;
  actorStaffId?: string | null;
  meta?: RequestMeta;
}

/**
 * 1回分を記録し、上限を超えていれば WARN `rate_limit.exceeded` を残して拒否の判定を返す。
 * API は拒否なら 429(rate_limited)を返す。
 */
export async function consumeQuota(
  deps: RateLimitDeps,
  rule: RateLimitRule,
  key: string,
  context: QuotaContext,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const decision = await deps.rateLimiter.consume(rule, key, now);
  if (!decision.allowed) {
    await deps.appLog.write({
      tenantId: context.tenantId,
      level: 'WARN',
      action: 'rate_limit.exceeded',
      actorStaffId: context.actorStaffId ?? null,
      details: { rule: rule.name, count: decision.count, limit: rule.limit },
      ...context.meta,
    });
  }
  return decision;
}
