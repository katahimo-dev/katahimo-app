import { importLatestCustomerCsv } from '@katahimo/ingestion';
import { customerCsvImportRequestSchema } from '@katahimo/shared';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Container } from '../container';
import { apiError, parseJsonBody } from '../http/responses';
import { requireAdmin, type SessionEnv } from '../session';

const STATUS_BY_RESULT: Record<string, ContentfulStatusCode> = {
  failed: 502,
  review_required: 409,
};

/**
 * 管理者向けの顧客CSV取込(/api/admin/customers)。POST /import は手動取込
 * (GAS版 forceImportCsv。既定で取込済みの版でも取り込み直す。消失率の安全装置は外さない)。
 */
export function createAdminImportRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.post('/import', requireAdmin(container, 'customer_csv.import'), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, customerCsvImportRequestSchema);
    if (!body.ok) return body.response;

    const tenant = await container.tenants.findById(session.tenantId);
    if (!tenant) return apiError(c, 404, 'not_found', 'テナントが見つかりません');

    const result = await importLatestCustomerCsv(container, {
      tenant,
      force: body.data.force,
      actor: { staffId: session.staffId, name: session.name },
    });
    return c.json(result, STATUS_BY_RESULT[result.status] ?? 200);
  });

  return app;
}
