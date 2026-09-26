import type { CustomerSummary } from '@katahimo/core/ports';
import { getCustomerDetail, listCustomers, searchCustomersByFamilyName } from '@katahimo/core/usecases';
import {
  customerDetailResponseSchema,
  customerListQuerySchema,
  customerListResponseSchema,
  idSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { apiError, jsonOk, parseQuery } from '../http/responses';
import type { SessionEnv } from '../session';
import { actorOf, requireSession } from '../session';

const toListItem = (c: CustomerSummary) => ({ id: c.id, name: c.displayName, phone: c.phone, city: c.city });

export function createCustomerRoutes(container: Container) {
  const app = new Hono<SessionEnv>();
  app.use('*', requireSession(container));

  /**
   * familyName 省略時はアーカイブされていない顧客の全件(GAS版 fetchDataFromSheet と同じく、部分一致・地区の
   * 絞り込み・並び替えは画面で行う)。指定時は苗字の完全一致。テナントは必ずセッションのものだけを使う。
   */
  app.get('/', async (c) => {
    const query = parseQuery(c, customerListQuerySchema);
    if (!query.ok) return query.response;
    const { tenantId } = c.get('session');
    if (!query.data.familyName) {
      const result = await listCustomers(container, tenantId);
      return jsonOk(c, customerListResponseSchema, {
        ...result,
        customers: result.customers.map(toListItem),
      });
    }
    const found = await searchCustomersByFamilyName(container, tenantId, query.data.familyName);
    const cities = [...new Set(found.map((f) => f.city).filter((v): v is string => Boolean(v)))].sort();
    return jsonOk(c, customerListResponseSchema, { customers: found.map(toListItem), cities });
  });

  /**
   * 顧客1件の全項目(子ども・アレルギー・緊急連絡先を含む)を返す。要配慮情報を含むため閲覧を INFO ログに
   * 残す(誰がどの顧客の詳細を開いたかを後から追えるように)。
   */
  app.get('/:id', async (c) => {
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) return apiError(c, 404, 'not_found', '顧客が見つかりません');
    const actor = actorOf(c);
    const customer = await getCustomerDetail(container, actor, id.data);
    await container.appLog.write({
      tenantId: actor.tenantId,
      level: 'INFO',
      action: 'customer.detail.viewed',
      actorStaffId: actor.staffId,
      details: { customerId: id.data },
      ...actor.meta,
    });
    return jsonOk(c, customerDetailResponseSchema, { customer });
  });

  return app;
}
