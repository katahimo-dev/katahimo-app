import { canActForOthers, isAdminRole, resolveTargetStaffId } from '@katahimo/core/domain';
import type { Actor, ResolvedSession } from '@katahimo/core/usecases';
import { authenticateSession } from '@katahimo/core/usecases';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Container } from './container';
import { requestMeta } from './http/requestMeta';
import { apiError } from './http/responses';

/**
 * セッションCookieの名前。本番(HTTPS)は `__Host-` 接頭辞付き(`__Host-katahimo_session`)にする:
 * ブラウザは Secure・Path=/・Domain なしのCookieにしかこの名前を許さないため、サブドメイン等の別の
 * オリジンから同名のCookieを上書き・注入されない。開発(http://localhost)は Secure を付けられないため
 * 接頭辞なし。
 */
export const SESSION_COOKIE_NAME = 'katahimo_session';

/** Cookie の接頭辞の指定(本番だけ `__Host-`)。 */
function cookiePrefix(container: Container): { prefix: 'host' } | Record<string, never> {
  return container.config.isProduction ? { prefix: 'host' } : {};
}

export function setSessionCookie(c: Context, container: Container, value: string, expires: Date): void {
  setCookie(c, SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: container.config.isProduction,
    sameSite: 'Lax',
    path: '/',
    expires,
    ...cookiePrefix(container),
  });
}

export function clearSessionCookie(c: Context, container: Container): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    secure: container.config.isProduction,
    sameSite: 'Lax',
    ...cookiePrefix(container),
  });
}

export function readSessionCookie(c: Context, container: Container): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME, container.config.isProduction ? 'host' : undefined);
}

/**
 * 「この端末」の印の Cookie の名前(core の usecases/auth/deviceTrust.ts)。セッション Cookie と同じく本番は `__Host-` 接頭辞付き
 * (`__Host-katahimo_device`)。ログインに成功するたびに発行し直し(期限180日)、ログアウトでは消さない(端末を表すもので、
 * セッションを表すものではない)。パスワードの変更・再設定・退職日の設定で、サーバーが受け付けなくなる。
 */
export const DEVICE_COOKIE_NAME = 'katahimo_device';

export function setDeviceCookie(c: Context, container: Container, value: string, expires: Date): void {
  setCookie(c, DEVICE_COOKIE_NAME, value, {
    httpOnly: true,
    secure: container.config.isProduction,
    sameSite: 'Lax',
    path: '/',
    expires,
    maxAge: Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000)),
    ...cookiePrefix(container),
  });
}

export function readDeviceCookie(c: Context, container: Container): string | undefined {
  return getCookie(c, DEVICE_COOKIE_NAME, container.config.isProduction ? 'host' : undefined);
}

/**
 * リクエストのCookieからログイン中ユーザーを解決する唯一の入口。
 *
 * CLAUDE.mdのセキュリティパターン(クライアント指定のスタッフ名/テナントIDを一切信用しない)
 * をAPI全体で1箇所に集約するためのヘルパー。各ルートはこの戻り値の`tenantId`/`staffId`だけを
 * 使い、リクエストボディやクエリパラメータのtenantId/staffId(があっても)は無視すること。
 * セッションの有効期限を延長した場合はCookieの期限も更新する。
 */
export async function getAuthenticatedSession(
  c: Context,
  container: Container,
  options: { isInitialLoad?: boolean } = {},
): Promise<ResolvedSession | null> {
  const cookieValue = readSessionCookie(c, container);
  if (!cookieValue) return null;
  const meta = requestMeta(c);
  const result = await authenticateSession(container, cookieValue, {
    ...(options.isInitialLoad
      ? { isInitialLoad: true, failureLogGate: () => container.denialLogThrottle.take(meta.ip) }
      : {}),
    meta,
  });
  if (!result.ok) {
    clearSessionCookie(c, container);
    return null;
  }
  if (result.session.renewed) setSessionCookie(c, container, cookieValue, result.session.expiresAt);
  return result.session;
}

/**
 * ログインしていない要求の拒否を WARN `<action>.access_denied`(reason `invalid_session`)に残す。認証の無い要求は誰でも
 * 送れるため、送信元IPごとに間引く(http/denialLogThrottle.ts。応答は変えない)。
 */
async function logUnauthenticatedDenial(c: Context, container: Container, action: string): Promise<void> {
  const meta = requestMeta(c);
  const gate = container.denialLogThrottle.take(meta.ip);
  if (!gate) return;
  await container.appLog.write({
    tenantId: null,
    level: 'WARN',
    action: `${action}.access_denied`,
    details: { reason: 'invalid_session', ...(gate.suppressed > 0 ? { suppressed: gate.suppressed } : {}) },
    ...meta,
  });
}

/** ルートのContext変数(requireSession/requireAdminが設定する)。 */
export interface SessionEnv {
  Variables: { session: ResolvedSession };
}

/**
 * ログイン必須のルート用ミドルウェア。未ログインは401。
 * deniedActionを渡すと、未ログインでのアクセスをWARNログに残す(GAS版の*AccessDeniedに相当)。
 */
export function requireSession(container: Container, deniedAction?: string): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) {
      if (deniedAction) await logUnauthenticatedDenial(c, container, deniedAction);
      return apiError(c, 401, 'unauthenticated', 'ログインセッションが無効です。再度ログインしてください。');
    }
    c.set('session', session);
    return next();
  };
}

/**
 * 管理者専用ルート用ミドルウェア。未ログインは401、管理者以外は403とし、どちらもWARNログに残す
 * (GAS版Auth.js logAdminAccessDenied_に相当)。
 */
export function requireAdmin(container: Container, action: string): MiddlewareHandler<SessionEnv> {
  return requireRole(container, action, isAdminRole, 'not_admin');
}

/**
 * コーディネーター・管理者(他のスタッフを扱える役割)専用ルート用ミドルウェア。未ログインは401、それ以外は403とし、
 * どちらもWARNログに残す。
 */
export function requireCoordinator(container: Container, action: string): MiddlewareHandler<SessionEnv> {
  return requireRole(container, action, canActForOthers, 'not_coordinator');
}

function requireRole(
  container: Container,
  action: string,
  allowed: (role: ResolvedSession['role']) => boolean,
  deniedReason: string,
): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) {
      await logUnauthenticatedDenial(c, container, action);
      return apiError(c, 401, 'unauthenticated', 'ログインセッションが無効です。再度ログインしてください。');
    }
    if (!allowed(session.role)) {
      // ログイン中のスタッフの拒否は間引かない(誰の操作か分かり、権限の確かめとして残す)
      await container.appLog.write({
        tenantId: session.tenantId,
        level: 'WARN',
        action: `${action}.access_denied`,
        actorStaffId: session.staffId,
        details: { reason: deniedReason },
        ...requestMeta(c),
      });
      return apiError(c, 403, 'forbidden', '権限がありません。');
    }
    c.set('session', session);
    return next();
  };
}

/** セッションの操作者(usecase に渡す。送信元の情報とリクエストIDを添える)。 */
export function actorOf(c: Context<SessionEnv>): Actor {
  const session = c.get('session');
  return { tenantId: session.tenantId, staffId: session.staffId, role: session.role, meta: requestMeta(c) };
}

/**
 * 操作の対象スタッフ(予定・出勤簿・報告・領収書で共通)。他のスタッフを扱えない役割(一般スタッフ)は
 * 要求にかかわらず本人、管理者・コーディネーターは指定があればそのスタッフ(CLAUDE.md の admin-vs-self。
 * GAS版 PastSchedule.js resolvePastScheduleTargetStaffName_ と同じ考え方)。
 */
export function targetStaffIdOf(c: Context<SessionEnv>, requestedStaffId: string | undefined): string {
  return resolveTargetStaffId(c.get('session'), requestedStaffId);
}
