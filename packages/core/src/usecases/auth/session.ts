import { isRetiredOn, jstBusinessDate } from '../../domain';
import type { RequestMeta } from '../requestMeta';
import type { AuthDeps, AuthWithLogDeps } from './deps';
import { currentTime } from './deps';
import { SESSION_TTL_MS } from './login';
import { decodeSessionCookie, hashSessionToken } from './sessionCookie';

/** 残りがこの日数を切ったセッションは7日に延長する(GAS版checkSessionと同じ)。 */
const SESSION_RENEW_THRESHOLD_MS = 6 * 24 * 60 * 60 * 1000;
/**
 * ローリング延長しても、ログインからこの期間を過ぎたセッションは無効にする(GAS版には無い上限)。
 * 盗まれたCookieを使い続けられる期間を限るため。
 */
export const SESSION_ABSOLUTE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface ResolvedSession {
  tenantId: string;
  staffId: string;
  sessionId: string;
  name: string;
  email: string;
  isAdmin: boolean;
  expiresAt: Date;
  /** このリクエストで有効期限を延長した(APIはCookieの期限も更新する)。 */
  renewed: boolean;
}

export type SessionFailureReason =
  | 'malformed'
  | 'unknown_token'
  | 'expired'
  | 'lifetime_exceeded'
  | 'tenant_suspended'
  | 'staff_not_found'
  | 'retired';

export type SessionCheckResult =
  | { ok: true; session: ResolvedSession }
  | { ok: false; reason: SessionFailureReason };

export interface AuthenticateSessionOptions {
  /**
   * ページ読み込み時(GET /api/auth/me)の検証か。GAS版checkSessionのisInitialLoadと同じく、
   * 成功(AutoLogin)・失敗(AutoLoginFailed)のログはこのときだけ記録する(全APIで毎回書くと
   * ログが溢れるため。各APIのアクセス拒否は呼び出し側が個別に記録する)。
   */
  isInitialLoad?: boolean;
  meta?: RequestMeta;
}

/**
 * セッションCookieの値からログイン中ユーザーを解決する。GAS版Auth.js checkSessionに対応。
 * クライアント指定のスタッフ名/IDを一切信用せず、サーバー側でCookieだけから本人を特定する。
 *
 * - 退職日を毎回確認し、退職済みならそのスタッフの全セッションを削除する。
 * - テナントが停止中('suspended')なら拒否する(セッション行は残し、再開すればそのまま使える)。
 * - 期限切れのセッション行・ログインから30日を過ぎたセッション行はその場で削除する。
 * - 残り6日を切ったら7日に延長する(ローリング延長。毎回は書き込まない)。延長後の期限はログインから
 *   30日を超えない。
 */
export async function authenticateSession(
  deps: AuthDeps & Partial<Pick<AuthWithLogDeps, 'appLog'>>,
  cookieValue: string,
  options: AuthenticateSessionOptions = {},
): Promise<SessionCheckResult> {
  const now = currentTime(deps);
  const fail = async (reason: SessionFailureReason, tenantId: string | null, staffId?: string) => {
    if (options.isInitialLoad && deps.appLog) {
      await deps.appLog.write({
        tenantId,
        level: 'WARN',
        action: 'auth.session.auto_login_failed',
        actorStaffId: staffId ?? null,
        details: { reason },
        ...options.meta,
      });
    }
    return { ok: false as const, reason };
  };

  const decoded = decodeSessionCookie(cookieValue);
  if (!decoded) return fail('malformed', null);

  const session = await deps.sessions.findByTokenHash(decoded.tenantId, hashSessionToken(decoded.rawToken));
  // Cookieのテナント部分は改ざんされ得るため、セッションが見つからない間はテナント不明として記録する。
  if (!session) return fail('unknown_token', null);

  if (session.expiresAt.getTime() <= now.getTime()) {
    await deps.sessions.delete(session.tenantId, session.id);
    return fail('expired', session.tenantId, session.staffId);
  }
  const absoluteExpiry = session.createdAt.getTime() + SESSION_ABSOLUTE_LIFETIME_MS;
  if (absoluteExpiry <= now.getTime()) {
    await deps.sessions.delete(session.tenantId, session.id);
    return fail('lifetime_exceeded', session.tenantId, session.staffId);
  }

  const tenant = await deps.tenants.findById(session.tenantId);
  if (tenant?.status !== 'active') return fail('tenant_suspended', session.tenantId, session.staffId);

  const staff = await deps.staff.findById(session.tenantId, session.staffId);
  if (!staff) return fail('staff_not_found', session.tenantId);

  if (isRetiredOn(staff.retirementDate, jstBusinessDate(now))) {
    await deps.sessions.deleteAllForStaff(session.tenantId, staff.id);
    return fail('retired', session.tenantId, staff.id);
  }

  let expiresAt = session.expiresAt;
  let renewed = false;
  const renewedExpiry = Math.min(now.getTime() + SESSION_TTL_MS, absoluteExpiry);
  if (
    expiresAt.getTime() - now.getTime() < SESSION_RENEW_THRESHOLD_MS &&
    renewedExpiry > expiresAt.getTime()
  ) {
    expiresAt = new Date(renewedExpiry);
    await deps.sessions.updateExpiry(session.tenantId, session.id, expiresAt);
    renewed = true;
  }

  if (options.isInitialLoad && deps.appLog) {
    await deps.appLog.write({
      tenantId: session.tenantId,
      level: 'INFO',
      action: 'auth.session.auto_login',
      actorStaffId: staff.id,
      ...options.meta,
    });
  }

  return {
    ok: true,
    session: {
      tenantId: session.tenantId,
      staffId: staff.id,
      sessionId: session.id,
      name: staff.name,
      email: staff.email,
      isAdmin: staff.isAdmin,
      expiresAt,
      renewed,
    },
  };
}

/** authenticateSessionの結果をセッションかnullだけにした簡易版(ログを伴わない通常のAPI呼び出し用)。 */
export async function resolveSession(deps: AuthDeps, cookieValue: string): Promise<ResolvedSession | null> {
  const result = await authenticateSession(deps, cookieValue);
  return result.ok ? result.session : null;
}

/** ログアウト。Cookieに対応するセッション行を削除する(Cookieが不正でも何もしないだけで失敗にしない)。 */
export async function logout(deps: AuthWithLogDeps, cookieValue: string, meta?: RequestMeta): Promise<void> {
  const decoded = decodeSessionCookie(cookieValue);
  if (!decoded) return;
  const session = await deps.sessions.findByTokenHash(decoded.tenantId, hashSessionToken(decoded.rawToken));
  if (!session) return;
  await deps.sessions.delete(session.tenantId, session.id);
  await deps.appLog.write({
    tenantId: session.tenantId,
    level: 'INFO',
    action: 'auth.logout',
    actorStaffId: session.staffId,
    ...meta,
  });
}
