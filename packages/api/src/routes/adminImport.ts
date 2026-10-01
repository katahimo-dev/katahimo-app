import { isAdminRole } from '@katahimo/core/domain';
import { importLatestCustomerCsv } from '@katahimo/ingestion';
import {
  type CustomerCsvImportStatus,
  customerCsvImportRequestSchema,
  customerCsvImportResponseSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { enforceStaffQuota } from '../http/quota';
import { requestMeta } from '../http/requestMeta';
import { apiError, DOMAIN_ERROR_STATUS, jsonOk, parseJsonBody } from '../http/responses';
import { requireCoordinator, type SessionEnv } from '../session';

/** 失敗の結果 → エラーの code(HTTP ステータスは DOMAIN_ERROR_STATUS と同じ)。 */
const FAILURE_CODE: Partial<Record<CustomerCsvImportStatus, 'conflict' | 'upstream_unavailable'>> = {
  failed: 'upstream_unavailable',
  review_required: 'conflict',
  busy: 'conflict',
};

/**
 * 顧客CSVの手動取込(/api/admin/customers)。POST /import は取込元の最新の顧客CSVを今すぐ取り込む
 * (GAS版 forceImportCsv。新しいお客様が訪問の直前に登録されたとき、定期実行を待たずに日報を書けるように)。
 * コーディネーター・管理者が使える。force(取込済みの版でも取り込み直す)は管理者だけ。消失率の安全装置はどちらも外さない。
 */
export function createAdminImportRoutes(container: Container) {
  const app = new Hono<SessionEnv>();

  app.post('/import', requireCoordinator(container, 'customer_csv.import'), async (c) => {
    const session = c.get('session');
    const body = await parseJsonBody(c, customerCsvImportRequestSchema);
    if (!body.ok) return body.response;
    if (body.data.force && !isAdminRole(session.role)) {
      await container.appLog.write({
        tenantId: session.tenantId,
        level: 'WARN',
        action: 'customer_csv.import.access_denied',
        actorStaffId: session.staffId,
        details: { reason: 'force_not_admin' },
        ...requestMeta(c),
      });
      return apiError(c, 403, 'forbidden', '取り込み直し(force)は管理者だけが使えます');
    }
    const limited = await enforceStaffQuota(
      c,
      container,
      container.rateLimits.customerCsvImportStaff,
      '顧客CSVの取込の回数が上限に達しました。しばらく待ってから再度お試しください。',
    );
    if (limited) return limited;
    const tenant = await container.tenants.findById(session.tenantId);
    if (!tenant) return apiError(c, 404, 'not_found', 'テナントが見つかりません');
    const result = await importLatestCustomerCsv(container, {
      tenant,
      force: body.data.force,
      actor: { staffId: session.staffId, name: session.name },
    });
    const code = FAILURE_CODE[result.status];
    if (!code) return jsonOk(c, customerCsvImportResponseSchema, result);
    return jsonOk(c, customerCsvImportResponseSchema, { ...result, code }, DOMAIN_ERROR_STATUS[code]);
  });

  return app;
}
