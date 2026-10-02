import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PasswordPolicyViolation } from '@katahimo/shared';
import { checkPasswordPolicy } from '@katahimo/shared';
import {
  isRetiredOn,
  maskEmail,
  newId,
  normalizeEmailForIndex,
  outboxDedupeKey,
  rateLimitIpSubject,
  resolvePasswordResetAddress,
  zonedBusinessDate,
} from '../../domain';
import type { RateLimitRule } from '../../domain/rateLimit';
import type { MailerPort, MailMessage } from '../../ports/mailer';
import type { StaffRecord } from '../../ports/staff';
import type { TenantRecord } from '../../ports/tenants';
import type { UnitOfWorkPort } from '../../ports/unitOfWork';
import { accountRateLimitKey } from '../rateLimits';
import type { Clock, RequestMeta } from '../requestMeta';
import { currentTime } from '../requestMeta';
import type { PasswordResetDeps } from './deps';

/** 再設定コードの有効期限(GAS版と同じ30分)。 */
export const RESET_CODE_TTL_MS = 30 * 60 * 1000;
/** 1つのコードに対する入力の上限(正しいコードの入力も含む)。これに達したコードは無効になる(総当たり対策)。 */
export const RESET_CODE_MAX_ATTEMPTS = 5;

/**
 * 再設定コードのメールの種類。reset: 本人の再設定の要求(GAS版 requestPasswordReset) /
 * setup_guide: 管理者が送るパスワード設定の案内(パスワード未設定・GAS版のパスワードのままのスタッフ向け)。
 */
export type PasswordResetMailPurpose = 'reset' | 'setup_guide';

/** 案内のメールに書くログインの手がかり(法人ID・画面の URL)。 */
export interface PasswordResetMailContext {
  tenantSlug: string;
  /** 画面の URL(APP_PUBLIC_URL)。無ければ URL は書かない。 */
  appPublicUrl?: string | undefined;
}

/** 法人IDつきのログイン画面の URL(`?t=<法人ID>` で法人IDの欄を出さずに開く。web の lib/tenant.ts)。 */
export function loginUrlFor(appPublicUrl: string, tenantSlug: string): string {
  const url = new URL(appPublicUrl);
  url.searchParams.set('t', tenantSlug);
  return url.toString();
}

/** reset は GAS版 requestPasswordReset のメール文面そのまま。setup_guide には法人ID・ログイン画面の URL も書く。 */
export function buildPasswordResetMail(
  to: string,
  code: string,
  purpose: PasswordResetMailPurpose = 'reset',
  context?: PasswordResetMailContext,
): MailMessage {
  if (purpose === 'setup_guide') {
    const lines = [
      'ログインに使うパスワードを設定してください。',
      'ログイン画面の「パスワードを忘れたときはこちら」→「番号が届いている方はこちら」を押し、' +
        'このメールアドレス・下の番号・新しいパスワードを入力します。',
      '',
      ...(context?.appPublicUrl
        ? [`ログイン画面: ${loginUrlFor(context.appPublicUrl, context.tenantSlug)}`]
        : []),
      ...(context ? [`法人ID(事業所ID): ${context.tenantSlug}`] : []),
      `コード: ${code}`,
      '有効期限: 30分',
    ];
    return { to, subject: '【保育日報】パスワード設定のご案内', text: lines.join('\n') };
  }
  return {
    to,
    subject: '【保育日報】パスワード再設定認証コード',
    text: `パスワード再設定のリクエストを受け付けました。\n以下の認証コードを入力してください。\n\nコード: ${code}\n有効期限: 30分`,
  };
}

/** outbox の payload から読むメールの種類(payload には種類だけを入れる)。 */
export function passwordResetMailPurposeOf(payload: Record<string, unknown>): PasswordResetMailPurpose {
  return payload.purpose === 'setup_guide' ? 'setup_guide' : 'reset';
}

/**
 * 再設定コードを発行し、メールの送信を outbox に積む(同じトランザクション。片方だけが残らない)。
 * 同じスタッフの古いコードは無効になる。
 */
export async function issuePasswordResetCode(
  deps: { uow: UnitOfWorkPort; resetCodeSecret: string },
  tenantId: string,
  target: { staffId: string; sentTo: string; purpose: PasswordResetMailPurpose },
  now: Date,
): Promise<void> {
  const code = String(randomInt(100000, 1000000));
  const codeId = newId();
  await deps.uow.run(tenantId, async (r) => {
    await r.passwordResetCodes.replaceActive(
      {
        id: codeId,
        staffId: target.staffId,
        codeHash: hashResetCode(deps.resetCodeSecret, target.staffId, code),
        sentToEmail: target.sentTo,
        expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MS),
        maxAttempts: RESET_CODE_MAX_ATTEMPTS,
        mailCode: code,
      },
      now,
    );
    await r.outbox.enqueue({
      topic: 'mail.password_reset',
      aggregateType: 'password_reset_code',
      aggregateId: codeId,
      dedupeKey: outboxDedupeKey('mail.password_reset', codeId, 0),
      ...(target.purpose === 'reset' ? {} : { payload: { purpose: target.purpose } }),
    });
  });
}

/** コードのハッシュ。スタッフIDを混ぜた HMAC にし、同じコードでもスタッフごとに異なる値にする。 */
export function hashResetCode(secret: string, staffId: string, code: string): Uint8Array {
  return createHmac('sha256', secret).update(`${staffId}:${code}`, 'utf8').digest();
}

function sameHash(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

type Lookup =
  | { ok: true; tenant: TenantRecord; staff: StaffRecord; loginId: string }
  | { ok: false; tenantId: string | null; reason: string };

/** テナント+ログインIDから在籍中のスタッフを探す(見つからない理由はログにだけ残す)。 */
async function findAccount(
  deps: PasswordResetDeps,
  tenantSlug: string,
  email: string,
  now: Date,
): Promise<Lookup> {
  const tenant = await deps.tenants.findBySlug(tenantSlug.trim().toLowerCase());
  if (!tenant) return { ok: false, tenantId: null, reason: 'tenant_not_found' };
  if (tenant.status !== 'active') return { ok: false, tenantId: tenant.id, reason: 'tenant_suspended' };
  const loginId = normalizeEmailForIndex(email);
  const staff = await deps.uow.run(tenant.id, (r) => r.staff.findByLoginEmail(loginId));
  if (!staff) return { ok: false, tenantId: tenant.id, reason: 'unknown_login_id' };
  if (isRetiredOn(staff.retiredOn, zonedBusinessDate(now, tenant.timezone))) {
    return { ok: false, tenantId: tenant.id, reason: 'retired' };
  }
  return { ok: true, tenant, staff, loginId };
}

/** 送信元IP単位・アカウント単位の回数を1回分数える。どちらかが上限を超えていればその範囲を返す。 */
async function consumeResetLimits(
  deps: PasswordResetDeps,
  rules: { ip: RateLimitRule; account: RateLimitRule },
  input: { tenantSlug: string; email: string; meta?: RequestMeta },
  now: Date,
): Promise<{ limited: false } | { limited: true; scope: 'ip' | 'account'; retryAfterMs: number }> {
  // IPv6 は /64 ごとに数える(rateLimitIpSubject)
  const ip = input.meta?.ip ? rateLimitIpSubject(input.meta.ip) : null;
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

/** 内部向けの結果。API は ip_rate_limited(429)以外は同じ応答を返し、アカウントの有無を伝えない。 */
export type RequestPasswordResetOutcome =
  | { status: 'queued' | 'rejected' | 'rate_limited' }
  | { status: 'ip_rate_limited'; retryAfterMs: number };

/**
 * パスワード再設定コードを発行し、メール送信を outbox に積む(GAS版 Auth.js requestPasswordReset)。
 * - コードは6桁の数字。照合用には HMAC だけを保存する。メールに書くコード(mail_code)は
 *   送信までの間だけ持ち、送信後に消す(outbox の payload にも入れない)。
 * - コードの作成とメールの積み込みは同じトランザクション(片方だけが残らない)。メールはワーカーが送る
 *   (SMTP の所要時間から、アカウントの有無が応答時間に表れないように)。
 * - 新しいコードを発行すると古いコードは無効。発行要求は送信元IP・アカウント単位で回数を制限し、上限を
 *   超えた要求では既存のコードに触れない(第三者が有効なコードを無効にし続けられない)。
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
    if (limits.scope === 'ip') return { status: 'ip_rate_limited', retryAfterMs: limits.retryAfterMs };
    // 受け付けたときと同じ応答にするため、起動の依頼も同じだけ行う(deps.outboxDrain)
    await deps.outboxDrain?.notify();
    return { status: 'rate_limited' };
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
    await deps.outboxDrain?.notify();
    return { status: 'rejected' };
  }
  const { tenant, staff, loginId } = found;

  const sentTo = resolvePasswordResetAddress(staff, loginId);
  await issuePasswordResetCode(deps, tenant.id, { staffId: staff.id, sentTo, purpose: 'reset' }, now);

  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'SECURITY',
    action: 'auth.password_reset.requested',
    actorStaffId: staff.id,
    details: { sentTo: sentTo === staff.email ? 'email' : 'alt_email' },
    ...input.meta,
  });
  return { status: 'queued' };
}

export interface PasswordResetMailDeps extends Clock {
  uow: UnitOfWorkPort;
  mailer: MailerPort;
  /** 画面の URL(案内のメールに書く)。 */
  appPublicUrl?: string | undefined;
}

/**
 * outbox の mail.password_reset 1件分: 送信待ちのコードをメールで送り、送信後にコードを消す(照合は code_hash
 * だけで行うため、コードそのものは送信までしか持たない。outbox の payload にも入れない)。
 * 使用済み・無効化済み・期限切れ・送信済みのコードには何もしない(再試行・二重実行に対して冪等)。
 * 送信に失敗したら例外にし、outbox の再試行に任せる。送信はトランザクションの外で行う。
 */
export async function sendPasswordResetMail(
  deps: PasswordResetMailDeps,
  tenantId: string,
  codeId: string,
  purpose: PasswordResetMailPurpose = 'reset',
): Promise<void> {
  const now = currentTime(deps);
  const record = await deps.uow.run(tenantId, async (r) => {
    const code = await r.passwordResetCodes.findById(codeId);
    if (!code?.mailCode || code.usedAt) return null;
    if (code.expiresAt.getTime() <= now.getTime()) {
      await r.passwordResetCodes.clearMailCode(codeId);
      return null;
    }
    return { code, tenantSlug: (await r.tenant()).slug };
  });
  if (!record?.code.mailCode) return;
  await deps.mailer.send(
    buildPasswordResetMail(record.code.sentToEmail, record.code.mailCode, purpose, {
      tenantSlug: record.tenantSlug,
      appPublicUrl: deps.appPublicUrl,
    }),
  );
  await deps.uow.run(tenantId, (r) => r.passwordResetCodes.clearMailCode(codeId));
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

type ConfirmOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid_code' | 'expired' | 'too_many_attempts'; log: string };

/**
 * 認証コードを確かめて新しいパスワードを設定する(GAS版 Auth.js resetPasswordWithCode)。
 * - アカウントが無い場合も「無効な認証コード」と同じ結果にする(利用者の列挙防止)。
 * - 試行回数の加算・上限判定は照合より前に1文の条件付き UPDATE(registerAttempt)で行い、使用済みへの遷移も
 *   条件付き UPDATE(consume)にする。コードの消費・パスワードの設定・全セッションの失効は同じトランザクション。
 * - 送信元IP単位・アカウント単位でも確認の回数を制限する(コードを発行し直しながらの総当たり対策)。
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
  const { tenant, staff } = found;
  const hashed = hashResetCode(deps.resetCodeSecret, staff.id, input.code.trim());
  const newPasswordHash = await deps.passwordHasher.hash(input.newPassword);

  const outcome = await deps.uow.run<ConfirmOutcome>(tenant.id, async (r) => {
    const latest = await r.passwordResetCodes.findLatestUnused(staff.id);
    if (!latest) return { ok: false, reason: 'invalid_code', log: 'no_active_code' };
    // 期限切れのコードは数えずに照合だけ行い、正しいコードだった場合にだけ期限切れと伝える
    if (latest.expiresAt.getTime() <= now.getTime()) {
      if (!sameHash(hashed, latest.codeHash))
        return { ok: false, reason: 'invalid_code', log: 'invalid_code' };
      await r.passwordResetCodes.markUsed(latest.id, now);
      return { ok: false, reason: 'expired', log: 'expired' };
    }
    const attempt = await r.passwordResetCodes.registerAttempt(latest.id, now);
    if (!attempt) {
      // 試行回数の上限、または並列の要求が先にコードを使用・無効化した
      await r.passwordResetCodes.markUsed(latest.id, now);
      return { ok: false, reason: 'too_many_attempts', log: 'too_many_attempts' };
    }
    if (!sameHash(hashed, attempt.codeHash)) {
      const exhausted = attempt.attemptCount >= attempt.maxAttempts;
      if (exhausted) await r.passwordResetCodes.markUsed(attempt.id, now);
      const reason = exhausted ? 'too_many_attempts' : 'invalid_code';
      return { ok: false, reason, log: reason };
    }
    if (!(await r.passwordResetCodes.consume(attempt.id, now))) {
      return { ok: false, reason: 'invalid_code', log: 'already_used' };
    }
    await r.staff.setPasswordHash(staff.id, newPasswordHash);
    await r.sessions.revokeAllForStaff(staff.id, now);
    return { ok: true };
  });

  if (!outcome.ok) {
    await logFailure(tenant.id, outcome.log, staff.id);
    return { ok: false, reason: outcome.reason };
  }
  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'SECURITY',
    action: 'auth.password_reset.completed',
    actorStaffId: staff.id,
    ...input.meta,
  });
  return { ok: true };
}
