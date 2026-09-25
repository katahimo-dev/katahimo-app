import { authenticateSession } from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Container } from './container';
import { requestMeta } from './http/requestMeta';
import { apiError } from './http/responses';

export const SESSION_COOKIE_NAME = 'katahimo_session';

export function setSessionCookie(c: Context, container: Container, value: string, expires: Date): void {
  setCookie(c, SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: container.config.isProduction,
    sameSite: 'Lax',
    path: '/',
    expires,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
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
  const cookieValue = readSessionCookie(c);
  if (!cookieValue) return null;
  const result = await authenticateSession(container, cookieValue, {
    isInitialLoad: options.isInitialLoad,
    meta: requestMeta(c),
  });
  if (!result.ok) {
    clearSessionCookie(c);
    return null;
  }
  if (result.session.renewed) setSessionCookie(c, container, cookieValue, result.session.expiresAt);
  return result.session;
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
      if (deniedAction) {
        await container.appLog.write({
          tenantId: null,
          level: 'WARN',
          action: `${deniedAction}.access_denied`,
          details: { reason: 'invalid_session' },
          ...requestMeta(c),
        });
      }
      return apiError(c, 401, 'unauthenticated', 'ログインセッションが無効です。再度ログインしてください。');
    }
    c.set('session', session);
    await next();
  };
}

/**
 * 管理者専用ルート用ミドルウェア。未ログインは401、管理者以外は403とし、どちらもWARNログに残す
 * (GAS版Auth.js logAdminAccessDenied_に相当)。
 */
export function requireAdmin(container: Container, action: string): MiddlewareHandler<SessionEnv> {
  return async (c, next) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session?.isAdmin) {
      await container.appLog.write({
        tenantId: session?.tenantId ?? null,
        level: 'WARN',
        action: `${action}.access_denied`,
        actorStaffId: session?.staffId ?? null,
        details: { reason: session ? 'not_admin' : 'invalid_session' },
        ...requestMeta(c),
      });
      return session
        ? apiError(c, 403, 'forbidden', '権限がありません。')
        : apiError(c, 401, 'unauthenticated', 'ログインセッションが無効です。再度ログインしてください。');
    }
    c.set('session', session);
    await next();
  };
}

/**
 * 管理者以外は自分自身のstaffIdに強制し、管理者だけが明示的なstaffIdクエリで
 * 他スタッフを指定できるようにする。
 *
 * 移植元: gas-childcare-visit-app/PastSchedule.js の resolvePastScheduleTargetStaffName_
 * (getPastScheduleAccessContext_とセットで使われるパターン)と同じ考え方。
 */
export function resolveAttendanceTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}

/**
 * 「訪問完了」通知用。管理者以外は自分自身のstaffIdに強制する(日報・領収書の保存は
 * usecase側でactorから同じ規則を適用する)。
 */
export function resolveReportTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}

/**
 * 「予定」タブ用。管理者以外は自分自身のstaffIdに強制し、管理者だけが明示的なstaffId指定で
 * 他スタッフの予定を閲覧できるようにする(GAS版Schedule.js resolveScheduleTargetStaffName_)。
 */
export function resolveScheduleTargetStaffId(
  session: ResolvedSession,
  requestedStaffId: string | undefined,
): string {
  if (!session.isAdmin) return session.staffId;
  const requested = (requestedStaffId ?? '').trim();
  return requested || session.staffId;
}
