import { changePassword, login } from '@katahimo/core';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import type { Container } from '../container';
import { getAuthenticatedSession, SESSION_COOKIE_NAME } from '../session';

interface LoginBody {
  tenantSlug?: unknown;
  email?: unknown;
  password?: unknown;
}

export function createAuthRoutes(container: Container, isProduction: boolean) {
  const app = new Hono();

  app.post('/login', async (c) => {
    const body = (await c.req.json().catch(() => null)) as LoginBody | null;
    if (
      !body ||
      typeof body.tenantSlug !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.password !== 'string'
    ) {
      return c.json({ code: 'validation_failed', message: 'tenantSlug, email, password が必要です' }, 400);
    }

    const result = await login(container, {
      tenantSlug: body.tenantSlug,
      email: body.email,
      password: body.password,
    });

    if (!result.ok) {
      const status = result.reason === 'tenant_not_found' ? 404 : 401;
      return c.json({ code: 'unauthenticated', message: 'メールアドレスまたはパスワードが違います' }, status);
    }

    setCookie(c, SESSION_COOKIE_NAME, result.sessionCookieValue, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'Lax',
      path: '/',
      expires: result.expiresAt,
    });

    return c.json({ staff: result.staff });
  });

  app.get('/me', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    return c.json({ staff: session });
  });

  app.post('/logout', (c) => {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return c.json({ ok: true });
  });

  /** ログイン中スタッフ自身のパスワード変更。GAS版Auth.js changePassword相当。 */
  app.post('/change-password', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const body = (await c.req.json().catch(() => null)) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    } | null;
    if (
      !body ||
      typeof body.currentPassword !== 'string' ||
      typeof body.newPassword !== 'string' ||
      !body.newPassword
    ) {
      return c.json({ success: false, message: 'currentPassword, newPassword が必要です' }, 400);
    }

    const result = await changePassword(
      container,
      session.tenantId,
      session.staffId,
      body.currentPassword,
      body.newPassword,
    );
    if (!result.ok) {
      const message =
        result.reason === 'incorrect_current_password'
          ? '現在のパスワードが正しくありません'
          : 'セッションが無効です';
      return c.json({ success: false, message }, 400);
    }
    return c.json({ success: true });
  });

  return app;
}
