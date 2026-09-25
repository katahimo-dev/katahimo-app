import { importLatestCustomerCsv } from '@katahimo/ingestion';
import { customerCsvImportRequestSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';
import { parseJsonBody } from '../validation';

const STATUS_BY_RESULT: Record<string, ContentfulStatusCode> = {
  failed: 502,
  review_required: 409,
};

/**
 * 管理者向けの取込操作。POST /api/admin/customers/import は顧客CSVの手動取込
 * (GAS版 forceImportCsv。既定で取込済みの版でも取り込み直す。消失率の安全装置は外さない)。
 */
export function createAdminImportRoutes(container: Container) {
  const app = new Hono();

  app.post('/customers/import', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) {
      await container.appLog.write({
        tenantId: session.tenantId,
        level: 'WARN',
        action: 'customer_csv.import_denied',
        actorStaffId: session.staffId,
      });
      return c.json({ code: 'forbidden', message: '権限がありません。' }, 403);
    }
    const body = await parseJsonBody(c, customerCsvImportRequestSchema);
    if (!body.ok) return body.response;

    const tenant = await container.tenants.findById(session.tenantId);
    if (!tenant) return c.json({ code: 'not_found', message: 'テナントが見つかりません' }, 404);

    const result = await importLatestCustomerCsv(container, {
      tenant,
      force: body.data.force,
      actor: { staffId: session.staffId, name: session.name },
    });
    return c.json(result, STATUS_BY_RESULT[result.status] ?? 200);
  });

  return app;
}
