import { getCustomerDetail, listCustomers, searchCustomersByFamilyName } from '@katahimo/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Container } from '../container';
import { requestMeta } from '../http/requestMeta';
import { apiError } from '../http/responses';
import type { SessionEnv } from '../session';
import { requireSession } from '../session';

const customerIdSchema = z.string().uuid();

export function createCustomerRoutes(container: Container) {
  const app = new Hono<SessionEnv>();
  app.use('*', requireSession(container));

  /**
   * `familyName` 省略時は有効な顧客を全件返す(GAS版 fetchDataFromSheet と同じく、部分一致・地区絞り込み・
   * 並び替えはクライアント側で行う)。指定時は苗字のブラインドインデックス完全一致検索。
   * tenantId は必ずセッション由来のものだけを使う。
   */
  app.get('/', async (c) => {
    const { tenantId } = c.get('session');
    const familyName = c.req.query('familyName');
    if (!familyName) return c.json(await listCustomers(container, tenantId));
    return c.json({ customers: await searchCustomersByFamilyName(container, tenantId, familyName) });
  });

  /**
   * 顧客1件の全項目(世帯構成員含む)を復号して返す。要配慮情報(アレルギー・緊急連絡先等)を含むため、
   * 閲覧をINFOログに残す(GAS版には無い監査ログ。誰がどの顧客の詳細を開いたかを後から追えるようにする)。
   * 担当の顧客だけに絞るかは運用で決める(現状はGAS版と同じく全スタッフが全顧客を閲覧できる)。
   */
  app.get('/:id', async (c) => {
    const { tenantId, staffId } = c.get('session');
    const id = customerIdSchema.safeParse(c.req.param('id'));
    if (!id.success) return apiError(c, 404, 'not_found', '顧客が見つかりません');
    const detail = await getCustomerDetail(container, tenantId, id.data);
    if (!detail) return apiError(c, 404, 'not_found', '顧客が見つかりません');
    await container.appLog.write({
      tenantId,
      level: 'INFO',
      action: 'customer.detail.viewed',
      actorStaffId: staffId,
      details: { customerId: id.data },
      ...requestMeta(c),
    });
    return c.json({ customer: detail });
  });

  return app;
}
