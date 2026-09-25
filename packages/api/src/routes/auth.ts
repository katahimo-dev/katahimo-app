import { changePassword, confirmPasswordReset, login, logout, requestPasswordReset } from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
import type { SessionUser } from '@katahimo/shared';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  PASSWORD_POLICY_MESSAGES,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError, parseJsonBody, rateLimited } from '../http/responses';
import type { SessionEnv } from '../session';
import {
  clearSessionCookie,
  getAuthenticatedSession,
  readSessionCookie,
  requireSession,
  setSessionCookie,
} from '../session';

function toSessionUser(session: ResolvedSession): SessionUser {
  return {
    staffId: session.staffId,
    tenantId: session.tenantId,
    name: session.name,
    email: session.email,
    isAdmin: session.isAdmin,
  };
}

/** ログインの失敗が続いたときの案内(アカウント単位・送信元IP単位のどちらのロックでも同じ文面)。 */
const LOGIN_LOCKED_MESSAGE =
  'ログインの失敗が続いたため、一時的にログインできません。しばらく(15分ほど)待ってから再度お試しください。';
/** パスワード再設定の要求が多すぎるときの案内。 */
const RESET_RATE_LIMITED_MESSAGE =
  'パスワード再設定の要求が多すぎます。しばらく待ってから再度お試しください。';

/** 再設定コードの発行要求への応答(アカウントの有無を伝えないため常に同じ文面)。 */
const RESET_REQUEST_ACCEPTED_MESSAGE =
  '登録されているメールアドレスであれば、認証コードを送信しました。メールをご確認ください(有効期限30分)。';

export function createAuthRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  /** GAS版Auth.js verifyLogin。email/サブメールのどちらでもログインできる。 */
  app.post('/login', async (c) => {
    const body = await parseJsonBody(c, loginRequestSchema);
    if (!body.ok) return body.response;

    const result = await login(container, { ...body.data, meta: requestMeta(c) });
    if (!result.ok) {
      if (result.reason === 'locked') return rateLimited(c, result.retryAfterMs, LOGIN_LOCKED_MESSAGE);
      const message =
        result.reason === 'retired'
          ? 'ログイン権限のないユーザーです'
          : result.reason === 'tenant_suspended'
            ? 'ご利用の法人は現在利用を停止しています。管理者にお問い合わせください'
            : 'メールアドレスまたはパスワードが違います';
      return apiError(c, 401, 'unauthenticated', message);
    }

    setSessionCookie(c, container, result.sessionCookieValue, result.expiresAt);
    const staff: SessionUser = {
      staffId: result.staff.id,
      tenantId: result.staff.tenantId,
      name: result.staff.name,
      email: result.staff.email,
      isAdmin: result.staff.isAdmin,
    };
    return c.json({ staff });
  });

  /** ページ読み込み時のセッション確認(GAS版checkSession(token, isInitialLoad=true))。 */
  app.get('/me', async (c) => {
    const session = await getAuthenticatedSession(c, container, { isInitialLoad: true });
    if (!session) return apiError(c, 401, 'unauthenticated', '未ログインです');
    return c.json({ staff: toSessionUser(session) });
  });

  /** ログアウト。Cookieを消すだけでなく、サーバー側のセッション行も削除する。 */
  app.post('/logout', async (c) => {
    const cookieValue = readSessionCookie(c, container);
    if (cookieValue) await logout(container, cookieValue, requestMeta(c));
    clearSessionCookie(c, container);
    return c.json({ ok: true });
  });

  /** ログイン中スタッフ自身のパスワード変更。GAS版Auth.js changePassword。 */
  app.post('/change-password', requireSession(container, 'auth.password_change'), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, changePasswordRequestSchema);
    if (!body.ok) return body.response;

    const result = await changePassword(container, {
      tenantId: session.tenantId,
      staffId: session.staffId,
      sessionId: session.sessionId,
      currentPassword: body.data.currentPassword,
      newPassword: body.data.newPassword,
      meta: requestMeta(c),
    });
    if (!result.ok) {
      if (result.reason === 'weak_password') {
        return apiError(c, 400, 'validation_failed', PASSWORD_POLICY_MESSAGES[result.violation]);
      }
      if (result.reason === 'incorrect_current_password') {
        return apiError(c, 400, 'validation_failed', '現在のパスワードが正しくありません');
      }
      return apiError(c, 401, 'unauthenticated', 'セッションが無効です');
    }
    return c.json({ success: true as const, message: 'パスワードを変更しました' });
  });

  /**
   * GAS版Auth.js requestPasswordReset。成否・アカウントの有無にかかわらず同じ応答を返す(メールは
   * ワーカーが送る)。送信元IP単位の上限を超えた場合だけ 429(アカウントの有無とは関係しないため)。
   */
  app.post('/password-reset/request', async (c) => {
    const body = await parseJsonBody(c, passwordResetRequestSchema);
    if (!body.ok) return body.response;
    const outcome = await requestPasswordReset(container, { ...body.data, meta: requestMeta(c) });
    if (outcome.status === 'ip_rate_limited') {
      return rateLimited(c, outcome.retryAfterMs, RESET_RATE_LIMITED_MESSAGE);
    }
    return c.json({ ok: true as const, message: RESET_REQUEST_ACCEPTED_MESSAGE });
  });

  /** GAS版Auth.js resetPasswordWithCode。 */
  app.post('/password-reset/confirm', async (c) => {
    const body = await parseJsonBody(c, passwordResetConfirmSchema);
    if (!body.ok) return body.response;

    const result = await confirmPasswordReset(container, { ...body.data, meta: requestMeta(c) });
    if (!result.ok) {
      if (result.reason === 'rate_limited') {
        return rateLimited(c, result.retryAfterMs, RESET_RATE_LIMITED_MESSAGE);
      }
      const message =
        result.reason === 'weak_password'
          ? PASSWORD_POLICY_MESSAGES[result.violation]
          : result.reason === 'expired'
            ? '認証コードの有効期限が切れています'
            : result.reason === 'too_many_attempts'
              ? '認証コードの入力回数が上限を超えました。もう一度認証コードを発行してください'
              : '無効な認証コードです';
      return apiError(c, 400, 'validation_failed', message);
    }
    return c.json({ ok: true as const, message: 'パスワードを再設定しました' });
  });

  return app;
}
