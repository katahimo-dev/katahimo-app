import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PasswordPolicyViolation } from '@katahimo/shared';
import { checkPasswordPolicy } from '@katahimo/shared';
import {
  isRetiredOn,
  jstBusinessDate,
  maskEmail,
  normalizeEmailForIndex,
  resolvePasswordResetAddress,
} from '../../domain';
import type { MailMessage } from '../../ports/mailer';
import type { StaffRecord } from '../../ports/repositories';
import type { RequestMeta } from '../requestMeta';
import type { PasswordResetDeps } from './deps';
import { currentTime } from './deps';

/** 再設定コードの有効期限(GAS版と同じ30分)。 */
export const RESET_CODE_TTL_MS = 30 * 60 * 1000;
/** 1つのコードに対する誤入力の上限。これに達したコードは無効になる(総当たり対策)。 */
export const RESET_CODE_MAX_ATTEMPTS = 5;
/** 1スタッフあたりのコード発行回数の上限(RESET_REQUEST_WINDOW_MSの期間内)。メール爆撃対策。 */
export const RESET_REQUEST_LIMIT = 5;
export const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000;

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
  const loginId = normalizeEmailForIndex(loginIdInput);
  const staff = await deps.staff.findByLoginEmail(tenant.id, loginId);
  if (!staff) return { ok: false, tenantId: tenant.id, reason: 'unknown_login_id' };
  if (isRetiredOn(staff.retirementDate, jstBusinessDate(now))) {
    return { ok: false, tenantId: tenant.id, reason: 'retired' };
  }
  return { ok: true, account: { tenantId: tenant.id, staff, loginId } };
}

export interface RequestPasswordResetInput {
  tenantSlug: string;
  /** メールアドレスまたはサブメール。 */
  email: string;
  meta?: RequestMeta;
}

/** 内部向けの結果(テスト・ログ用)。APIはどの場合も同じ応答を返し、アカウントの有無を伝えない。 */
export type RequestPasswordResetOutcome = 'sent' | 'rejected' | 'rate_limited' | 'mail_failed';

/**
 * パスワード再設定コードを発行してメールで送る。GAS版Auth.js requestPasswordResetに対応。
 *
 * - コードは6桁の数字(GAS版と同じ100000〜999999)。DBにはHMACだけを保存する。
 * - 送信先はGAS版resolveResetMailAddress_と同じ規則(サブメールで入力されたらサブメール宛)。
 * - 新しいコードを発行すると、同じスタッフの未使用コードは無効になる。
 * - 1時間あたりの発行回数に上限を設ける(GAS版には無かったメール爆撃対策)。
 */
export async function requestPasswordReset(
  deps: PasswordResetDeps,
  input: RequestPasswordResetInput,
): Promise<RequestPasswordResetOutcome> {
  const now = currentTime(deps);
  const found = await findAccount(deps, input.tenantSlug, input.email, now);
  if (!found.ok) {
    await deps.appLog.write({
      tenantId: found.tenantId,
      level: 'WARN',
      action: 'auth.password_reset.request_rejected',
      details: { reason: found.reason, loginId: maskEmail(normalizeEmailForIndex(input.email)) },
      ...input.meta,
    });
    return 'rejected';
  }
  const { tenantId, staff, loginId } = found.account;

  const issuedRecently = await deps.passwordResetCodes.countIssuedSince(
    tenantId,
    staff.id,
    new Date(now.getTime() - RESET_REQUEST_WINDOW_MS),
  );
  if (issuedRecently >= RESET_REQUEST_LIMIT) {
    await deps.appLog.write({
      tenantId,
      level: 'WARN',
      action: 'auth.password_reset.request_rejected',
      actorStaffId: staff.id,
      details: { reason: 'rate_limited', issuedRecently },
      ...input.meta,
    });
    return 'rate_limited';
  }

  const sentTo = resolvePasswordResetAddress(staff, loginId);
  const code = String(randomInt(100000, 1000000));
  await deps.passwordResetCodes.replaceActive(
    {
      tenantId,
      staffId: staff.id,
      codeHash: hashResetCode(deps.resetCodeSecret, staff.id, code),
      sentToEmail: sentTo,
      expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MS),
    },
    now,
  );

  const sentToType = sentTo === staff.email ? 'email' : 'alt_email';
  try {
    await deps.mailer.send(buildPasswordResetMail(sentTo, code));
  } catch (e) {
    await deps.appLog.write({
      tenantId,
      level: 'ERROR',
      action: 'auth.password_reset.mail_failed',
      actorStaffId: staff.id,
      details: { sentTo: sentToType, error: e instanceof Error ? e.message : String(e) },
      ...input.meta,
    });
    return 'mail_failed';
  }

  await deps.appLog.write({
    tenantId,
    level: 'SECURITY',
    action: 'auth.password_reset.requested',
    actorStaffId: staff.id,
    details: { sentTo: sentToType },
    ...input.meta,
  });
  return 'sent';
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
  | { ok: false; reason: 'weak_password'; violation: PasswordPolicyViolation };

/**
 * 認証コードを確認して新しいパスワードを設定する。GAS版Auth.js resetPasswordWithCodeに対応。
 *
 * - アカウントが存在しない場合も「無効な認証コード」と同じ結果にする(利用者の列挙防止)。
 * - コードは1回限り。誤入力はRESET_CODE_MAX_ATTEMPTS回までで、上限に達したコードは無効になる。
 * - 再設定に成功したら、そのスタッフの全セッションを失効させる。
 */
export async function confirmPasswordReset(
  deps: PasswordResetDeps,
  input: ConfirmPasswordResetInput,
): Promise<ConfirmPasswordResetResult> {
  const violation = checkPasswordPolicy(input.newPassword);
  if (violation) return { ok: false, reason: 'weak_password', violation };

  const now = currentTime(deps);
  const logFailure = (tenantId: string | null, reason: string, staffId?: string) =>
    deps.appLog.write({
      tenantId,
      level: 'WARN',
      action: 'auth.password_reset.failed',
      actorStaffId: staffId ?? null,
      details: { reason },
      ...input.meta,
    });

  const found = await findAccount(deps, input.tenantSlug, input.email, now);
  if (!found.ok) {
    await logFailure(found.tenantId, found.reason);
    return { ok: false, reason: 'invalid_code' };
  }
  const { tenantId, staff } = found.account;

  const record = await deps.passwordResetCodes.findLatestUnused(tenantId, staff.id);
  if (!record) {
    await logFailure(tenantId, 'no_active_code', staff.id);
    return { ok: false, reason: 'invalid_code' };
  }
  if (record.attemptCount >= RESET_CODE_MAX_ATTEMPTS) {
    await deps.passwordResetCodes.markUsed(tenantId, record.id, now);
    await logFailure(tenantId, 'too_many_attempts', staff.id);
    return { ok: false, reason: 'too_many_attempts' };
  }

  const inputHash = hashResetCode(deps.resetCodeSecret, staff.id, input.code.trim());
  if (!sameHash(inputHash, record.codeHash)) {
    const attempts = await deps.passwordResetCodes.incrementAttempts(tenantId, record.id);
    const exhausted = attempts >= RESET_CODE_MAX_ATTEMPTS;
    if (exhausted) await deps.passwordResetCodes.markUsed(tenantId, record.id, now);
    await logFailure(tenantId, exhausted ? 'too_many_attempts' : 'invalid_code', staff.id);
    return { ok: false, reason: exhausted ? 'too_many_attempts' : 'invalid_code' };
  }

  if (record.expiresAt.getTime() <= now.getTime()) {
    await deps.passwordResetCodes.markUsed(tenantId, record.id, now);
    await logFailure(tenantId, 'expired', staff.id);
    return { ok: false, reason: 'expired' };
  }

  await deps.passwordResetCodes.markUsed(tenantId, record.id, now);
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
