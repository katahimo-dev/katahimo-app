import { isRetiredOn, jstBusinessDate, maskEmail, normalizeEmailForIndex } from '../../domain';
import type { RequestMeta } from '../requestMeta';
import type { AuthWithLogDeps } from './deps';
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

export type LoginFailureReason = 'invalid_credentials' | 'retired';

export type LoginResult =
  | {
      ok: true;
      /** httpOnly Cookieにそのまま保存する値。tenantIdを含むため、これ単体で以後のセッション検証が完結する。 */
      sessionCookieValue: string;
      expiresAt: Date;
      staff: LoggedInStaff;
    }
  | { ok: false; reason: LoginFailureReason };

/**
 * メール(またはサブメール)+パスワードでのログイン。GAS版Auth.js verifyLoginに対応。
 *
 * テナントはログインフォームで渡される`tenantSlug`から先に特定する(RLS対象外のtenantsテーブル)。
 * 利用者の列挙を防ぐため、テナント・アカウントが存在しない場合もパスワード不一致と同じ結果を返す。
 * 退職済みの判定はパスワードが一致した後に行う(パスワードを知らない人に在籍状況を伝えないため。
 * GAS版はパスワード検証より前に判定していた)。
 */
export async function login(deps: AuthWithLogDeps, input: LoginInput): Promise<LoginResult> {
  const now = currentTime(deps);
  const loginId = normalizeEmailForIndex(input.email);
  const logFailure = async (tenantId: string | null, reason: string, staffId?: string) => {
    await deps.appLog.write({
      tenantId,
      level: 'SECURITY',
      action: 'auth.login.failed',
      actorStaffId: staffId ?? null,
      details: { reason, loginId: maskEmail(loginId) },
      ...input.meta,
    });
  };

  const tenant = await deps.tenants.findBySlug(input.tenantSlug.trim());
  if (!tenant) {
    await logFailure(null, 'tenant_not_found');
    return { ok: false, reason: 'invalid_credentials' };
  }

  const staff = await deps.staff.findByLoginEmail(tenant.id, loginId);
  if (!staff) {
    await logFailure(tenant.id, 'unknown_login_id');
    return { ok: false, reason: 'invalid_credentials' };
  }

  const check = await checkStaffPassword(deps, staff, input.password);
  if (check === 'mismatch') {
    await logFailure(
      tenant.id,
      staff.passwordHash || staff.legacyPasswordHash ? 'invalid_password' : 'password_not_set',
      staff.id,
    );
    return { ok: false, reason: 'invalid_credentials' };
  }

  // GAS版から移行したスタッフは、一致したパスワードでargon2idへサイレント再ハッシュする
  // (パスワード変更を利用者に求めずに移行するための仕組み)。
  if (check === 'matched_legacy') {
    await deps.staff.updatePasswordHash(tenant.id, staff.id, await deps.passwordHasher.hash(input.password));
  }

  if (isRetiredOn(staff.retirementDate, jstBusinessDate(now))) {
    await logFailure(tenant.id, 'retired', staff.id);
    return { ok: false, reason: 'retired' };
  }

  const rawToken = issueSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await deps.sessions.create({
    tenantId: tenant.id,
    staffId: staff.id,
    tokenHash: hashSessionToken(rawToken),
    expiresAt,
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
