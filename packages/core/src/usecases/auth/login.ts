import { isRetiredOn, jstBusinessDate, maskEmail, normalizeEmailForIndex } from '../../domain';
import { accountRateLimitKey } from '../rateLimits';
import type { RequestMeta } from '../requestMeta';
import type { LoginDeps } from './deps';
import { currentTime } from './deps';
import { checkStaffPassword } from './passwordVerification';
import { encodeSessionCookie, hashSessionToken, issueSessionToken } from './sessionCookie';

/** セッションの有効期間(GAS版verifyLoginと同じ7日)。 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
  isAdmin: boolean;
}

export type LoginFailureReason = 'invalid_credentials' | 'retired' | 'tenant_suspended';

export type LoginResult =
  | {
      ok: true;
      /** httpOnly Cookieにそのまま保存する値。tenantIdを含むため、これ単体で以後のセッション検証が完結する。 */
      sessionCookieValue: string;
      expiresAt: Date;
      staff: LoggedInStaff;
    }
  | { ok: false; reason: LoginFailureReason }
  /** 失敗が続いたため一時的にロック中(アカウント単位または送信元IP単位)。 */
  | { ok: false; reason: 'locked'; retryAfterMs: number };

/**
 * メール(またはサブメール)+パスワードでのログイン。GAS版Auth.js verifyLoginに対応。
 *
 * テナントはログインフォームで渡される`tenantSlug`から先に特定する(RLS対象外のtenantsテーブル)。
 * 利用者の列挙を防ぐため、テナント・アカウントが存在しない場合もパスワード不一致と同じ結果を返し、
 * 照合するハッシュが無い場合もダミーのargon2照合で同じだけ時間をかける。
 * 退職済み・テナント停止中の判定はパスワードが一致した後に行う(パスワードを知らない人に在籍状況を
 * 伝えないため。GAS版はパスワード検証より前に判定していた)。
 *
 * 総当たり対策(GAS版には無い): 失敗をアカウント単位(入力されたテナント+ログインID。存在しない
 * アカウントも同じく数える)と送信元IP単位で数え、上限に達したら一定時間ロックする。ロック中は
 * パスワードを照合せずに拒否する。成功したらアカウント単位の失敗回数を戻す。
 */
export async function login(deps: LoginDeps, input: LoginInput): Promise<LoginResult> {
  const now = currentTime(deps);
  const loginId = normalizeEmailForIndex(input.email);
  const accountKey = accountRateLimitKey(input.tenantSlug, loginId);
  const ip = input.meta?.ip ?? null;
  const { loginFailureAccount, loginFailureIp } = deps.rateLimits;

  const [byAccount, byIp] = await Promise.all([
    deps.rateLimiter.peek(loginFailureAccount, accountKey, now),
    ip ? deps.rateLimiter.peek(loginFailureIp, ip, now) : null,
  ]);
  const blocked = !byAccount.allowed ? byAccount : byIp && !byIp.allowed ? byIp : null;
  if (blocked) {
    await deps.appLog.write({
      tenantId: null,
      level: 'SECURITY',
      action: 'auth.login.locked',
      details: { scope: blocked === byAccount ? 'account' : 'ip', loginId: maskEmail(loginId) },
      ...input.meta,
    });
    return { ok: false, reason: 'locked', retryAfterMs: blocked.retryAfterMs };
  }

  const recordFailure = async (tenantId: string | null, reason: string, staffId?: string) => {
    const [account, fromIp] = await Promise.all([
      deps.rateLimiter.consume(loginFailureAccount, accountKey, now),
      ip ? deps.rateLimiter.consume(loginFailureIp, ip, now) : null,
    ]);
    await deps.appLog.write({
      tenantId,
      level: 'SECURITY',
      action: 'auth.login.failed',
      actorStaffId: staffId ?? null,
      details: { reason, loginId: maskEmail(loginId) },
      ...input.meta,
    });
    const lockScope = account.lockStarted ? 'account' : fromIp?.lockStarted ? 'ip' : null;
    if (lockScope) {
      await deps.appLog.write({
        tenantId,
        level: 'SECURITY',
        action: 'auth.login.lockout_started',
        actorStaffId: staffId ?? null,
        details: { scope: lockScope, loginId: maskEmail(loginId) },
        ...input.meta,
      });
    }
  };

  const tenant = await deps.tenants.findBySlug(input.tenantSlug.trim());
  if (!tenant) {
    await deps.passwordHasher.verifyDummy(input.password);
    await recordFailure(null, 'tenant_not_found');
    return { ok: false, reason: 'invalid_credentials' };
  }

  const staff = await deps.staff.findByLoginEmail(tenant.id, loginId);
  if (!staff) {
    await deps.passwordHasher.verifyDummy(input.password);
    await recordFailure(tenant.id, 'unknown_login_id');
    return { ok: false, reason: 'invalid_credentials' };
  }

  const check = await checkStaffPassword(deps, staff, input.password);
  if (check === 'mismatch') {
    await recordFailure(
      tenant.id,
      staff.passwordHash || staff.legacyPasswordHash ? 'invalid_password' : 'password_not_set',
      staff.id,
    );
    return { ok: false, reason: 'invalid_credentials' };
  }
  await deps.rateLimiter.reset(loginFailureAccount, accountKey);

  // GAS版から移行したスタッフは、一致したパスワードでargon2idへサイレント再ハッシュする
  // (パスワード変更を利用者に求めずに移行するための仕組み)。
  if (check === 'matched_legacy') {
    await deps.staff.updatePasswordHash(tenant.id, staff.id, await deps.passwordHasher.hash(input.password));
  }

  const logRefused = (reason: string) =>
    deps.appLog.write({
      tenantId: tenant.id,
      level: 'SECURITY',
      action: 'auth.login.failed',
      actorStaffId: staff.id,
      details: { reason, loginId: maskEmail(loginId) },
      ...input.meta,
    });
  if (tenant.status !== 'active') {
    await logRefused('tenant_suspended');
    return { ok: false, reason: 'tenant_suspended' };
  }
  if (isRetiredOn(staff.retirementDate, jstBusinessDate(now))) {
    await logRefused('retired');
    return { ok: false, reason: 'retired' };
  }

  const rawToken = issueSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await deps.sessions.create({
    tenantId: tenant.id,
    staffId: staff.id,
    tokenHash: hashSessionToken(rawToken),
    expiresAt,
    createdAt: now,
  });

  await deps.appLog.write({
    tenantId: tenant.id,
    level: 'INFO',
    action: 'auth.login.succeeded',
    actorStaffId: staff.id,
    details: {
      loginIdType: staff.altEmail === loginId && staff.email !== loginId ? 'alt_email' : 'email',
      migratedLegacyPassword: check === 'matched_legacy',
    },
    ...input.meta,
  });

  return {
    ok: true,
    sessionCookieValue: encodeSessionCookie(tenant.id, rawToken),
    expiresAt,
    staff: {
      id: staff.id,
      tenantId: tenant.id,
      name: staff.name,
      email: staff.email,
      isAdmin: staff.isAdmin,
    },
  };
}
