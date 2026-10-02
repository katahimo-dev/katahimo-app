import type { ResolvedSession } from '@katahimo/core/usecases';
import {
  changePassword,
  confirmPasswordReset,
  login,
  logout,
  requestPasswordReset,
} from '@katahimo/core/usecases';
import type { SessionUser } from '@katahimo/shared';
import {
  changePasswordRequestSchema,
  changePasswordResponseSchema,
  loginRequestSchema,
  okResponseSchema,
  PASSWORD_POLICY_MESSAGES,
  passwordResetConfirmResponseSchema,
  passwordResetConfirmSchema,
  passwordResetRequestResponseSchema,
  passwordResetRequestSchema,
  sessionUserResponseSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError, jsonOk, parseJsonBody, rateLimited } from '../http/responses';
import type { SessionEnv } from '../session';
import {
  clearSessionCookie,
  getAuthenticatedSession,
  readDeviceCookie,
  readSessionCookie,
  requireSession,
  setDeviceCookie,
  setSessionCookie,
} from '../session';

/**
 * 画面に返すログイン中のスタッフ。demoTenant は公開デモ用テナント(DEMO_TENANT_SLUG)へのログインか
 * (DemoTenant がテナントの ID ごとの判定をプロセス内に覚えるので、要求のたびには DB を引かない)。
 */
async function toSessionUser(
  container: Container,
  staff: Pick<ResolvedSession, 'staffId' | 'tenantId' | 'name' | 'email' | 'role'>,
): Promise<SessionUser> {
  return {
    staffId: staff.staffId,
    tenantId: staff.tenantId,
    name: staff.name,
    email: staff.email,
    role: staff.role,
    demoTenant: container.demo ? await container.demo.isDemoTenant(staff.tenantId) : false,
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

    // 公開デモ用テナントはアカウント単位のロックをしない(共有のアカウントをわざと締め出させない。IP単位は残す)
    const deps = container.demo?.isDemoSlug(body.data.tenantSlug)
      ? { ...container, rateLimits: container.demo.loginRateLimits(container.rateLimits) }
      : container;
    const result = await login(deps, {
      ...body.data,
      deviceToken: readDeviceCookie(c, container),
      meta: requestMeta(c),
    });
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

    // セッションの Cookie を先に置く(Set-Cookie の順。テストは最初の Cookie をセッションとして読む)
    setSessionCookie(c, container, result.sessionCookieValue, result.expiresAt);
    setDeviceCookie(c, container, result.deviceToken.value, result.deviceToken.expiresAt);
    const staff = await toSessionUser(container, {
      staffId: result.staff.id,
      tenantId: result.staff.tenantId,
      name: result.staff.name,
      email: result.staff.email,
      role: result.staff.role,
    });
    return jsonOk(c, sessionUserResponseSchema, { staff });
  });

  /** ページ読み込み時のセッション確認(GAS版checkSession(token, isInitialLoad=true))。 */
  app.get('/me', async (c) => {
    const session = await getAuthenticatedSession(c, container, { isInitialLoad: true });
    if (!session) return apiError(c, 401, 'unauthenticated', '未ログインです');
    return jsonOk(c, sessionUserResponseSchema, { staff: await toSessionUser(container, session) });
  });

  /**
   * ログアウト。Cookie を消すだけでなく、サーバー側のセッションも失効させる。「この端末」の印の Cookie は残す
   * (端末を表すもので、次のログインでアカウントのロックを避けるため)。
   */
  app.post('/logout', async (c) => {
    const cookieValue = readSessionCookie(c, container);
    if (cookieValue) await logout(container, cookieValue, requestMeta(c));
    clearSessionCookie(c, container);
    return jsonOk(c, okResponseSchema, { ok: true });
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
    return jsonOk(c, changePasswordResponseSchema, { success: true, message: 'パスワードを変更しました' });
  });

  /**
   * GAS版Auth.js requestPasswordReset。成否・アカウントの有無にかかわらず同じ応答を返す(メールは
   * outbox-drain が送る)。送信元IP単位の上限を超えた場合だけ 429(アカウントの有無とは関係しないため)。
   */
  app.post('/password-reset/request', async (c) => {
    const body = await parseJsonBody(c, passwordResetRequestSchema);
    if (!body.ok) return body.response;
    const outcome = await requestPasswordReset(container, { ...body.data, meta: requestMeta(c) });
    if (outcome.status === 'ip_rate_limited') {
      return rateLimited(c, outcome.retryAfterMs, RESET_RATE_LIMITED_MESSAGE);
    }
    return jsonOk(c, passwordResetRequestResponseSchema, {
      ok: true,
      message: RESET_REQUEST_ACCEPTED_MESSAGE,
    });
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
    return jsonOk(c, passwordResetConfirmResponseSchema, { ok: true, message: 'パスワードを再設定しました' });
  });

  return app;
}
