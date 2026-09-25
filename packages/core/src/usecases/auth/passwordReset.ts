import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PasswordPolicyViolation } from '@katahimo/shared';
import { checkPasswordPolicy } from '@katahimo/shared';
import {
  ENCRYPTION_PURPOSES,
  isRetiredOn,
  jstBusinessDate,
  maskEmail,
  normalizeEmailForIndex,
  resolvePasswordResetAddress,
} from '../../domain';
import type { RateLimitRule } from '../../domain/rateLimit';
import type { CryptoPort } from '../../ports/crypto';
import type { MailerPort, MailMessage } from '../../ports/mailer';
import type { PasswordResetCodeRepositoryPort } from '../../ports/passwordResetCodes';
import type { StaffRecord } from '../../ports/repositories';
import { accountRateLimitKey } from '../rateLimits';
import type { RequestMeta } from '../requestMeta';
import type { PasswordResetDeps } from './deps';
import { currentTime } from './deps';

/** 再設定コードの有効期限(GAS版と同じ30分)。 */
export const RESET_CODE_TTL_MS = 30 * 60 * 1000;
/** 1つのコードに対する入力の上限(正しいコードの入力も含む)。これに達したコードは無効になる(総当たり対策)。 */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/** GAS版requestPasswordResetのメール文面そのまま。 */
export function buildPasswordResetMail(to: string, code: string): MailMessage {
  return {
    to,
    subject: '【保育日報】パスワード再設定認証コード',
    text: `パスワード再設定のリクエストを受け付けました。\n以下の認証コードを入力してください。\n\nコード: ${code}\n有効期限: 30分`,
  };
}

/** コードのハッシュ。スタッフIDを混ぜたHMACにし、同じコードでもスタッフごとに異なる値にする。 */
export function hashResetCode(secret: string, staffId: string, code: string): string {
  return createHmac('sha256', secret).update(`${staffId}:${code}`, 'utf8').digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

interface ResolvedAccount {
  tenantId: string;
  staff: StaffRecord;
  loginId: string;
}

/** テナント+ログインIDから在籍中のスタッフを探す。見つからない理由はログにだけ残す。 */
async function findAccount(
  deps: PasswordResetDeps,
  tenantSlug: string,
  loginIdInput: string,
  now: Date,
): Promise<{ ok: true; account: ResolvedAccount } | { ok: false; tenantId: string | null; reason: string }> {
  const tenant = await deps.tenants.findBySlug(tenantSlug.trim());
  if (!tenant) return { ok: false, tenantId: null, reason: 'tenant_not_found' };
  if (tenant.status !== 'active') return { ok: false, tenantId: tenant.id, reason: 'tenant_suspended' };
  const loginId = normalizeEmailForIndex(loginIdInput);
  const staff = await deps.staff.findByLoginEmail(tenant.id, loginId);
  if (!staff) return { ok: false, tenantId: tenant.id, reason: 'unknown_login_id' };
  if (isRetiredOn(staff.retirementDate, jstBusinessDate(now))) {
    return { ok: false, tenantId: tenant.id, reason: 'retired' };
  }
  return { ok: true, account: { tenantId: tenant.id, staff, loginId } };
}

/**
 * 送信元IP単位・アカウント単位(入力されたテナント+ログインID。アカウントの有無は問わない)の回数を
 * 1回分数える。どちらかが上限を超えていれば、その規則の名前を返す。
 */
async function consumeResetLimits(
  deps: PasswordResetDeps,
  rules: { ip: RateLimitRule; account: RateLimitRule },
  input: { tenantSlug: string; email: string; meta?: RequestMeta },
  now: Date,
): Promise<{ limited: false } | { limited: true; scope: 'ip' | 'account'; retryAfterMs: number }> {
  const ip = input.meta?.ip;
  if (ip) {
    const byIp = await deps.rateLimiter.consume(rules.ip, ip, now);
    if (!byIp.allowed) return { limited: true, scope: 'ip', retryAfterMs: byIp.retryAfterMs };
  }
  const accountKey = accountRateLimitKey(input.tenantSlug, normalizeEmailForIndex(input.email));
  const byAccount = await deps.rateLimiter.consume(rules.account, accountKey, now);
  if (!byAccount.allowed) return { limited: true, scope: 'account', retryAfterMs: byAccount.retryAfterMs };
  return { limited: false };
}

export interface RequestPasswordResetInput {
  tenantSlug: string;
  /** メールアドレスまたはサブメール。 */
  email: string;
  meta?: RequestMeta;
}

/**
 * 内部向けの結果(テスト・ログ用)。APIは ip_rate_limited(429)以外はどの場合も同じ応答を返し、
 * アカウントの有無を伝えない。
 */
export type RequestPasswordResetOutcome =
  | { status: 'queued' | 'rejected' | 'rate_limited' }
  | { status: 'ip_rate_limited'; retryAfterMs: number };

/**
 * パスワード再設定コードを発行し、メール送信をoutboxに積む。GAS版Auth.js requestPasswordResetに対応。
 *
 * - コードは6桁の数字(GAS版と同じ100000〜999999)。照合用にはHMACだけを保存し、メール送信までの間だけ
 *   暗号化したコードを持つ(ワーカーが送信後に消す)。
 * - メールはワーカーが送る(SMTPの所要時間が応答時間に表れて、アカウントの有無が分からないようにするため。
 *   Cloud Run のAPIは応答後にCPUが絞られるため、応答後の送信ではなくoutboxにした)。
 * - 送信先はGAS版resolveResetMailAddress_と同じ規則(サブメールで入力されたらサブメール宛)。
 * - 新しいコードを発行すると、同じスタッフの未使用コードは無効になる。発行要求は送信元IP単位・
 *   アカウント単位で回数を制限し(GAS版には無かったメール爆撃対策)、上限を超えた要求では既存の
 *   コードに触れない(第三者が有効なコードを無効にし続けられないようにする)。
 */
export async function requestPasswordReset(
  deps: PasswordResetDeps,
  input: RequestPasswordResetInput,
): Promise<RequestPasswordResetOutcome> {
  const now = currentTime(deps);
  const maskedLoginId = maskEmail(normalizeEmailForIndex(input.email));
  const limits = await consumeResetLimits(
    deps,
    { ip: deps.rateLimits.passwordResetRequestIp, account: deps.rateLimits.passwordResetRequestAccount },
    input,
    now,
  );
  if (limits.limited) {
    await deps.appLog.write({
      tenantId: null,
      level: 'WARN',
      action: 'auth.password_reset.request_rejected',
      details: { reason: 'rate_limited', scope: limits.scope, loginId: maskedLoginId },
      ...input.meta,
    });
    return limits.scope === 'ip'
      ? { status: 'ip_rate_limited', retryAfterMs: limits.retryAfterMs }
      : { status: 'rate_limited' };
  }

  const found = await findAccount(deps, input.tenantSlug, input.email, now);
  if (!found.ok) {
    await deps.appLog.write({
      tenantId: found.tenantId,
      level: 'WARN',
      action: 'auth.password_reset.request_rejected',
      details: { reason: found.reason, loginId: maskedLoginId },
      ...input.meta,
    });
    return { status: 'rejected' };
  }
  const { tenantId, staff, loginId } = found.account;

  const sentTo = resolvePasswordResetAddress(staff, loginId);
  const code = String(randomInt(100000, 1000000));
  const record = await deps.passwordResetCodes.replaceActive(
    {
      tenantId,
      staffId: staff.id,
      codeHash: hashResetCode(deps.resetCodeSecret, staff.id, code),
      sentToEmail: sentTo,
      expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MS),
      mailCode: await deps.crypto.encrypt(tenantId, code, ENCRYPTION_PURPOSES.passwordResetMailCode),
    },
    now,
  );
  await deps.mailOutbox.enqueue({
    tenantId,
    kind: 'password_reset_mail',
    targetId: record.id,
    idempotencyKey: `password_reset_mail:${record.id}`,
  });

  await deps.appLog.write({
    tenantId,
    level: 'SECURITY',
    action: 'auth.password_reset.requested',
    actorStaffId: staff.id,
    details: { sentTo: sentTo === staff.email ? 'email' : 'alt_email' },
    ...input.meta,
  });
  return { status: 'queued' };
}

export interface PasswordResetMailDeps {
  passwordResetCodes: PasswordResetCodeRepositoryPort;
  crypto: CryptoPort;
  mailer: MailerPort;
  now?: () => Date;
}

/**
 * outboxの password_reset_mail ジョブ1件分: 送信待ちのコードを復号してメールを送り、送信後にコードを消す。
 * 既に使用済み・無効化済み・期限切れ・送信済みのコードには何もしない(再試行・二重実行に対して冪等)。
 * 送信に失敗した場合は例外にし、outboxの再試行に任せる。
 */
export async function sendPasswordResetMail(
  deps: PasswordResetMailDeps,
  tenantId: string,
  codeId: string,
): Promise<void> {
  const record = await deps.passwordResetCodes.findById(tenantId, codeId);
  if (!record?.mailCode || record.usedAt) return;
  if (record.expiresAt.getTime() <= currentTime(deps).getTime()) {
    await deps.passwordResetCodes.clearMailCode(tenantId, codeId);
    return;
  }
  const code = await deps.crypto.decrypt(
    tenantId,
    record.mailCode,
    ENCRYPTION_PURPOSES.passwordResetMailCode,
  );
  await deps.mailer.send(buildPasswordResetMail(record.sentToEmail, code));
  await deps.passwordResetCodes.clearMailCode(tenantId, codeId);
}

export interface ConfirmPasswordResetInput {
  tenantSlug: string;
  email: string;
  code: string;
  newPassword: string;
  meta?: RequestMeta;
}

export type ConfirmPasswordResetResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_code' | 'expired' | 'too_many_attempts' }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }
  | { ok: false; reason: 'weak_password'; violation: PasswordPolicyViolation };

/**
 * 認証コードを確認して新しいパスワードを設定する。GAS版Auth.js resetPasswordWithCodeに対応。
 *
 * - アカウントが存在しない場合も「無効な認証コード」と同じ結果にする(利用者の列挙防止)。
 * - コードは1回限り。入力はRESET_CODE_MAX_ATTEMPTS回までで、上限に達したコードは無効になる。
 *   試行回数の加算と上限判定は照合より前に1文の条件付き更新で行い(registerAttempt)、使用済みへの遷移も
 *   条件付き更新(consume)にする。並列に送られた大量の確認要求でも上限を超えて試せず、同じコードで
 *   2回再設定することもできない。
 * - 送信元IP単位・アカウント単位でも確認の回数を制限する(コードを発行し直しながらの総当たり対策)。
 * - 再設定に成功したら、そのスタッフの全セッションを失効させる。
 */
export async function confirmPasswordReset(
  deps: PasswordResetDeps,
  input: ConfirmPasswordResetInput,
): Promise<ConfirmPasswordResetResult> {
  const violation = checkPasswordPolicy(input.newPassword);
  if (violation) return { ok: false, reason: 'weak_password', violation };

  const now = currentTime(deps);
  const logFailure = (tenantId: string | null, reason: string, staffId?: string, extra?: object) =>
    deps.appLog.write({
      tenantId,
      level: 'WARN',
      action: 'auth.password_reset.failed',
      actorStaffId: staffId ?? null,
      details: { reason, ...extra },
      ...input.meta,
    });

  const limits = await consumeResetLimits(
    deps,
    { ip: deps.rateLimits.passwordResetConfirmIp, account: deps.rateLimits.passwordResetConfirmAccount },
    input,
    now,
  );
  if (limits.limited) {
    await logFailure(null, 'rate_limited', undefined, { scope: limits.scope });
    return { ok: false, reason: 'rate_limited', retryAfterMs: limits.retryAfterMs };
  }

  const found = await findAccount(deps, input.tenantSlug, input.email, now);
  if (!found.ok) {
    await logFailure(found.tenantId, found.reason);
    return { ok: false, reason: 'invalid_code' };
  }
  const { tenantId, staff } = found.account;
  const matches = (codeHash: string) =>
    sameHash(hashResetCode(deps.resetCodeSecret, staff.id, input.code.trim()), codeHash);

  const latest = await deps.passwordResetCodes.findLatestUnused(tenantId, staff.id);
  if (!latest) {
    await logFailure(tenantId, 'no_active_code', staff.id);
    return { ok: false, reason: 'invalid_code' };
  }
  // 期限切れのコードは数えずに照合だけ行い、正しいコードだった場合にだけ期限切れと伝える
  if (latest.expiresAt.getTime() <= now.getTime()) {
    if (!matches(latest.codeHash)) {
      await logFailure(tenantId, 'invalid_code', staff.id);
      return { ok: false, reason: 'invalid_code' };
    }
    await deps.passwordResetCodes.markUsed(tenantId, latest.id, now);
    await logFailure(tenantId, 'expired', staff.id);
    return { ok: false, reason: 'expired' };
  }

  const attempt = await deps.passwordResetCodes.registerAttempt(
    tenantId,
    latest.id,
    RESET_CODE_MAX_ATTEMPTS,
    now,
  );
  if (!attempt) {
    // 試行回数の上限到達、または並列の要求が先にコードを使用・無効化した
    await deps.passwordResetCodes.markUsed(tenantId, latest.id, now);
    await logFailure(tenantId, 'too_many_attempts', staff.id);
    return { ok: false, reason: 'too_many_attempts' };
  }

  if (!matches(attempt.codeHash)) {
    const exhausted = attempt.attemptCount >= RESET_CODE_MAX_ATTEMPTS;
    if (exhausted) await deps.passwordResetCodes.markUsed(tenantId, attempt.id, now);
    await logFailure(tenantId, exhausted ? 'too_many_attempts' : 'invalid_code', staff.id);
    return { ok: false, reason: exhausted ? 'too_many_attempts' : 'invalid_code' };
  }

  if (!(await deps.passwordResetCodes.consume(tenantId, attempt.id, now))) {
    await logFailure(tenantId, 'already_used', staff.id);
    return { ok: false, reason: 'invalid_code' };
  }
  await deps.staff.updatePasswordHash(tenantId, staff.id, await deps.passwordHasher.hash(input.newPassword));
  await deps.sessions.deleteAllForStaff(tenantId, staff.id);

  await deps.appLog.write({
    tenantId,
    level: 'SECURITY',
    action: 'auth.password_reset.completed',
    actorStaffId: staff.id,
    ...input.meta,
  });
  return { ok: true };
}
