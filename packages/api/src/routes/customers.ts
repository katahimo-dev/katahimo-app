import { getCustomerDetail, listCustomers, searchCustomersByFamilyName } from '@katahimo/core';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

export function createCustomerRoutes(container: Container) {
  const app = new Hono();

  /**
   * `familyName`クエリ省略時は有効な顧客を全件返す(GAS版Main.js fetchDataFromSheetが顧客DB全件を
   * 一度にクライアントへ返し、名前の部分一致・地区絞り込み・並び替えはブラウザ側で行っていたのと
   * 同じ「訪問先一覧」タブの既定表示に使う)。`familyName`を指定した場合のみ、従来通り苗字の
   * ブラインドインデックス完全一致検索を行う。tenantIdは必ずセッションから取得したものだけを使い、
   * クエリパラメータでtenantIdを受け取ることはしない(他テナントの顧客を覗けてしまうため)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const familyName = c.req.query('familyName');
    if (!familyName) {
      const { customers, cities } = await listCustomers(container, session.tenantId);
      return c.json({ customers, cities });
    }

    const results = await searchCustomersByFamilyName(container, session.tenantId, familyName);
    return c.json({ customers: results });
  });

  /**
   * 顧客1件の全項目(世帯構成員含む)を復号して返す詳細取得。
   * こちらもtenantIdはセッション由来のものだけを使う(URLのcustomerIdだけでは他テナントの
   * 顧客IDを推測して覗かれる心配は無いが、念のためfindByIdもtenant_idでスコープする)。
   */
  app.get('/:id', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const customerId = c.req.param('id');
    const detail = await getCustomerDetail(container, session.tenantId, customerId);
    if (!detail) return c.json({ code: 'not_found', message: '顧客が見つかりません' }, 404);

    return c.json({ customer: detail });
  });

  return app;
}
