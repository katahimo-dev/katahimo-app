import { isRetiredOn, newId, zonedBusinessDate } from '../../domain';
import type { StaffRole } from '../../domain/model';
import type { SessionRepository } from '../../ports/staff';
import type { RequestMeta } from '../requestMeta';
import { currentTime } from '../requestMeta';
import type { AuthDeps } from './deps';
import {
  decodeSessionCookie,
  encodeSessionCookie,
  hashSessionToken,
  issueSessionToken,
} from './sessionCookie';

/** 無操作での有効期間(GAS版 verifyLogin と同じ7日。使うたびに延ばす)。 */
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 残りがこの時間を切ったら無操作の期限を延ばす(毎回は書き込まない)。 */
const SESSION_RENEW_THRESHOLD_MS = 6 * 24 * 60 * 60 * 1000;
/** ログインからの絶対的な有効期間(延長しても超えない。盗まれた Cookie を使い続けられる期間を限る)。 */
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ResolvedSession {
  tenantId: string;
  staffId: string;
  sessionId: string;
  name: string;
  email: string;
  role: StaffRole;
  /** Cookie の期限(無操作の期限)。 */
  expiresAt: Date;
  /** このリクエストで期限を延ばした(API は Cookie の期限も更新する)。 */
  renewed: boolean;
}

export type SessionFailureReason =
  | 'malformed'
  | 'unknown_token'
  | 'revoked'
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
   * ページ読み込み時(GET /api/auth/me)の確認か。GAS版 checkSession の isInitialLoad と同じく、成功・失敗の
   * ログはこのときだけ記録する(全 API で毎回書くとログが溢れるため)。
   */
  isInitialLoad?: boolean;
  /**
   * 失敗のログ(WARN `auth.session.auto_login_failed`)を書くかを決める(API が送信元IPごとに間引く。認証の無い要求は
   * 誰でも送れるため)。null を返せば書かない。書くときの suppressed(前に書かなかった件数)は details に残す。
   * 省けば毎回書く。
   */
  failureLogGate?: () => { suppressed: number } | null;
  meta?: RequestMeta;
}

/**
 * セッション Cookie からログイン中のスタッフを解決する(GAS版 Auth.js checkSession)。
 * クライアントが送ったスタッフ・テナントを一切信用せず、Cookie だけから本人を決める。
 * セッション・テナント・スタッフの確認と期限の延長を1回の短いトランザクションで行う。
 * - 失効済み・期限切れ・ログインから30日を過ぎたセッションは拒否する(行は保守ジョブが消す)。
 * - テナントが利用停止中なら拒否する(セッションは残し、再開すればそのまま使える)。
 * - 退職日(テナントのタイムゾーンの業務日)以降なら、そのスタッフの全セッションを失効させる。
 */
export async function authenticateSession(
  deps: AuthDeps,
  cookieValue: string,
  options: AuthenticateSessionOptions = {},
): Promise<SessionCheckResult> {
  const now = currentTime(deps);
  const decoded = decodeSessionCookie(cookieValue);
  const result: SessionCheckResult & { tenantId?: string | null; staffId?: string | null } = decoded
    ? await deps.uow.run(decoded.tenantId, async (r) => {
        const fail = (reason: SessionFailureReason, staffId: string | null = null) => ({
          ok: false as const,
          reason,
          tenantId: reason === 'unknown_token' ? null : decoded.tenantId,
          staffId,
        });
        const session = await r.sessions.findByTokenHash(hashSessionToken(decoded.rawToken));
        // Cookie のテナント部分は書き換えられうるため、セッションが見つかるまではテナント不明として記録する
        if (!session) return fail('unknown_token');
        if (session.revokedAt) return fail('revoked', session.staffId);
        if (session.absoluteExpiresAt.getTime() <= now.getTime())
          return fail('lifetime_exceeded', session.staffId);
        if (session.idleExpiresAt.getTime() <= now.getTime()) return fail('expired', session.staffId);
        const tenant = await r.tenant();
        if (tenant.status !== 'active') return fail('tenant_suspended', session.staffId);
        const staff = await r.staff.findById(session.staffId);
        if (!staff) return fail('staff_not_found');
        if (isRetiredOn(staff.retiredOn, zonedBusinessDate(now, tenant.timezone))) {
          await r.sessions.revokeAllForStaff(staff.id, now);
          return fail('retired', staff.id);
        }
        let expiresAt = session.idleExpiresAt;
        let renewed = false;
        const renewedExpiry = Math.min(
          now.getTime() + SESSION_IDLE_TTL_MS,
          session.absoluteExpiresAt.getTime(),
        );
        if (
          expiresAt.getTime() - now.getTime() < SESSION_RENEW_THRESHOLD_MS &&
          renewedExpiry > expiresAt.getTime()
        ) {
          expiresAt = new Date(renewedExpiry);
          await r.sessions.touch(session.id, now, expiresAt);
          renewed = true;
        }
        return {
          ok: true as const,
          session: {
            tenantId: decoded.tenantId,
            staffId: staff.id,
            sessionId: session.id,
            name: staff.displayName,
            email: staff.email,
            role: staff.role,
            expiresAt,
            renewed,
          },
        };
      })
    : { ok: false, reason: 'malformed', tenantId: null };

  if (options.isInitialLoad) {
    if (result.ok) {
      await deps.appLog.write({
        tenantId: result.session.tenantId,
        level: 'INFO',
        action: 'auth.session.auto_login',
        actorStaffId: result.session.staffId,
        ...options.meta,
      });
    } else {
      const gate = options.failureLogGate ? options.failureLogGate() : { suppressed: 0 };
      if (gate) {
        await deps.appLog.write({
          tenantId: result.tenantId ?? null,
          level: 'WARN',
          action: 'auth.session.auto_login_failed',
          actorStaffId: result.staffId ?? null,
          details: { reason: result.reason, ...(gate.suppressed > 0 ? { suppressed: gate.suppressed } : {}) },
          ...options.meta,
        });
      }
    }
  }
  return result.ok ? { ok: true, session: result.session } : { ok: false, reason: result.reason };
}

/** 新しいセッションを作り、Cookie の値を返す(ログインの最後の書き込みと同じトランザクションで呼ぶ)。 */
export async function openSession(
  sessions: SessionRepository,
  input: { tenantId: string; staffId: string; now: Date; meta?: RequestMeta },
): Promise<{ cookieValue: string; expiresAt: Date }> {
  const rawToken = issueSessionToken();
  const expiresAt = new Date(input.now.getTime() + SESSION_IDLE_TTL_MS);
  await sessions.create({
    id: newId(),
    staffId: input.staffId,
    tokenHash: hashSessionToken(rawToken),
    createdAt: input.now,
    idleExpiresAt: expiresAt,
    absoluteExpiresAt: new Date(input.now.getTime() + SESSION_ABSOLUTE_TTL_MS),
    ip: input.meta?.ip ?? null,
    userAgent: input.meta?.userAgent ?? null,
  });
  return { cookieValue: encodeSessionCookie(input.tenantId, rawToken), expiresAt };
}

/** ログアウト。Cookie のセッションを失効させる(Cookie が不正でも失敗にはしない)。 */
export async function logout(deps: AuthDeps, cookieValue: string, meta?: RequestMeta): Promise<void> {
  const decoded = decodeSessionCookie(cookieValue);
  if (!decoded) return;
  const now = currentTime(deps);
  const staffId = await deps.uow.run(decoded.tenantId, async (r) => {
    const session = await r.sessions.findByTokenHash(hashSessionToken(decoded.rawToken));
    if (!session || session.revokedAt) return null;
    await r.sessions.revoke(session.id, now);
    return session.staffId;
  });
  if (!staffId) return;
  await deps.appLog.write({
    tenantId: decoded.tenantId,
    level: 'INFO',
    action: 'auth.logout',
    actorStaffId: staffId,
    ...meta,
  });
}
