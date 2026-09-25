import { isRetiredOn, maskEmail, normalizeEmailForIndex, zonedBusinessDate } from '../../domain';
import type { StaffRole } from '../../domain/model';
import { accountRateLimitKey } from '../rateLimits';
import type { RequestMeta } from '../requestMeta';
import { currentTime } from '../requestMeta';
import type { LoginDeps } from './deps';
import { checkStaffPassword } from './passwordVerification';
import { openSession } from './session';

export interface LoginInput {
  tenantSlug: string;
  /** スタッフのメールアドレスまたはサブメール(GAS版のE列/M列のどちらでもよい)。 */
  email: string;
  password: string;
  meta?: RequestMeta;
}

export interface LoggedInStaff {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: StaffRole;
}

export type LoginFailureReason = 'invalid_credentials' | 'retired' | 'tenant_suspended';

export type LoginResult =
  | { ok: true; sessionCookieValue: string; expiresAt: Date; staff: LoggedInStaff }
  | { ok: false; reason: LoginFailureReason }
  /** 失敗が続いたため一時的にロック中(アカウント単位または送信元IP単位)。 */
  | { ok: false; reason: 'locked'; retryAfterMs: number };

/**
 * メール(またはサブメール)+パスワードでのログイン(GAS版 Auth.js verifyLogin)。
 *
 * テナントはログインフォームの tenantSlug で先に特定する(platform.tenants、RLS なし)。利用者の列挙を防ぐため、
 * テナント・アカウントが無い場合もパスワード不一致と同じ結果を返し、ダミーの argon2 照合で同じだけ時間をかける。
 * 退職済み・テナント停止中の判定はパスワードが一致した後に行う(パスワードを知らない人に在籍状況を伝えない)。
 * 総当たり対策: 試行をアカウント単位(存在しないアカウントも同じく数える)と送信元IP単位で数え、上限で一時ロック。
 * 数えるのはパスワードの照合の前(枠を取ってから照合する)。照合の後に数えると、同時に送られた多数の試行が全て
 * 「まだ上限前」と判定されて照合まで進んでしまう。成功した回は取り消す(アカウントは数え直し、送信元IPは1回分を返す)。
 * パスワードの照合(argon2、時間がかかる)はトランザクションの外で行う。
 */
export async function login(deps: LoginDeps, input: LoginInput): Promise<LoginResult> {
  const now = currentTime(deps);
  const loginId = normalizeEmailForIndex(input.email);
  const accountKey = accountRateLimitKey(input.tenantSlug, loginId);
  const ip = input.meta?.ip ?? null;
  const { loginFailureAccount, loginFailureIp } = deps.rateLimits;
  const masked = maskEmail(loginId);

  // 先に1回分の枠を取る(同時の試行でも、照合まで進めるのは上限の回数まで)
  const [byAccount, byIp] = await Promise.all([
    deps.rateLimiter.consume(loginFailureAccount, accountKey, now),
    ip ? deps.rateLimiter.consume(loginFailureIp, ip, now) : null,
  ]);
  const blocked = !byAccount.allowed ? byAccount : byIp && !byIp.allowed ? byIp : null;
  if (blocked) {
    await deps.appLog.write({
      tenantId: null,
      level: 'SECURITY',
      action: 'auth.login.locked',
      details: { scope: blocked === byAccount ? 'account' : 'ip', loginId: masked },
      ...input.meta,
    });
    return { ok: false, reason: 'locked', retryAfterMs: blocked.retryAfterMs };
  }

  const recordFailure = async (tenantId: string | null, reason: string, staffId?: string) => {
    if (tenantId && staffId) {
      const lockedUntil = byAccount.lockStarted ? new Date(now.getTime() + byAccount.retryAfterMs) : null;
      await deps.uow.run(tenantId, (r) => r.staff.recordLoginFailure(staffId, lockedUntil));
    }
    await deps.appLog.write({
      tenantId,
      level: 'SECURITY',
      action: 'auth.login.failed',
      actorStaffId: staffId ?? null,
      details: { reason, loginId: masked },
      ...input.meta,
    });
    const lockScope = byAccount.lockStarted ? 'account' : byIp?.lockStarted ? 'ip' : null;
    if (lockScope) {
      await deps.appLog.write({
        tenantId,
        level: 'SECURITY',
        action: 'auth.login.lockout_started',
        actorStaffId: staffId ?? null,
        details: { scope: lockScope, loginId: masked },
        ...input.meta,
      });
    }
  };

  const tenant = await deps.tenants.findBySlug(input.tenantSlug.trim().toLowerCase());
  if (!tenant) {
    await deps.passwordHasher.verifyDummy(input.password);
    await recordFailure(null, 'tenant_not_found');
    return { ok: false, reason: 'invalid_credentials' };
  }

  const account = await deps.uow.run(tenant.id, async (r) => {
    const staff = await r.staff.findByLoginEmail(loginId);
    return staff ? { staff, credentials: await r.staff.getCredentials(staff.id) } : null;
  });
  if (!account) {
    await deps.passwordHasher.verifyDummy(input.password);
    await recordFailure(tenant.id, 'unknown_login_id');
    return { ok: false, reason: 'invalid_credentials' };
  }
  const { staff, credentials } = account;

  const check = await checkStaffPassword(deps, credentials, input.password);
  if (check === 'mismatch') {
    const reason =
      credentials?.passwordHash || credentials?.legacyPasswordHash ? 'invalid_password' : 'password_not_set';
    await recordFailure(tenant.id, reason, staff.id);
    return { ok: false, reason: 'invalid_credentials' };
  }
  // パスワードが一致した回は数えない(アカウントは数え直し、送信元IPは先に取った1回分を返す)
  await Promise.all([
    deps.rateLimiter.reset(loginFailureAccount, accountKey),
    ip ? deps.rateLimiter.refund(loginFailureIp, ip) : null,
  ]);

  const refuse = async (reason: 'tenant_suspended' | 'retired'): Promise<LoginResult> => {
    await deps.appLog.write({
      tenantId: tenant.id,
      level: 'SECURITY',
      action: 'auth.login.failed',
      actorStaffId: staff.id,
      details: { reason, loginId: masked },
      ...input.meta,
    });
    return { ok: false, reason };
  };
  if (tenant.status !== 'active') return refuse('tenant_suspended');
  if (isRetiredOn(staff.retiredOn, zonedBusinessDate(now, tenant.timezone))) return refuse('retired');

  // GAS版から移行したスタッフは、一致したパスワードで argon2id へ移す(パスワード変更を求めずに移行する)
  const rehashed = check === 'matched_legacy' ? await deps.passwordHasher.hash(input.password) : null;
  const opened = await deps.uow.run(tenant.id, async (r) => {
    if (rehashed) await r.staff.setPasswordHash(staff.id, rehashed);
    await r.staff.recordLoginSuccess(staff.id);
    return openSession(r.sessions, {
      tenantId: tenant.id,
      staffId: staff.id,
      now,
      ...(input.meta ? { meta: input.meta } : {}),
    });
  });

  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'INFO',
    action: 'auth.login.succeeded',
    actorStaffId: staff.id,
    details: {
      loginIdType: staff.email === loginId ? 'email' : 'alt_email',
      migratedLegacyPassword: rehashed !== null,
    },
    ...input.meta,
  });

  return {
    ok: true,
    sessionCookieValue: opened.cookieValue,
    expiresAt: opened.expiresAt,
    staff: {
      id: staff.id,
      tenantId: tenant.id,
      name: staff.displayName,
      email: staff.email,
      role: staff.role,
    },
  };
}
