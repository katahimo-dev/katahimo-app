import { listActiveStaffForAdmin } from '@katahimo/core';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

export function createStaffRoutes(container: Container) {
  const app = new Hono();

  /**
   * 管理者向け「対象スタッフ」一覧(退職者を除く)。予定/勤怠タブの管理者用スタッフ選択に使う。
   * 管理者以外が呼んだ場合は空配列を返す(GAS版getActiveStaffNamesForAdminと同じ挙動)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ staff: [] });

    const staff = await listActiveStaffForAdmin(container, session.tenantId);
    return c.json({ staff });
  });

  return app;
}
