import { newId } from '@katahimo/core/domain';
import type { AppLogPort, UnitOfWorkPort } from '@katahimo/core/ports';
import {
  type AuthenticatedIntegrationKey,
  applyCustomerSnapshot,
  type CustomerSnapshotIssue,
  type RequestMeta,
  type SnapshotOutcome,
} from '@katahimo/core/usecases';
import type { IntegrationCustomer, IntegrationCustomersResponse } from '@katahimo/shared';
import { integrationCustomerToSnapshot } from './toCustomerSnapshot';

export interface IntegrationCustomersDeps {
  uow: UnitOfWorkPort;
  appLog: AppLogPort;
  now?: () => Date;
}

/**
 * 外部システムから受け取った顧客を1トランザクションで取り込む(POST /api/integrations/customers)。
 * 顧客CSVの取込と同じ applyCustomerSnapshot で、キーの取込元 × 顧客ID で突き合わせて作成・変わった項目だけを
 * 更新する(ID を保つ)。削除・アーカイブはしない(送られなかった顧客はそのまま。消えた顧客のアーカイブは顧客CSVの
 * 全件の取込だけが行う)。値の誤りは書く前に直すか、その1件だけ飛ばす(skipped。理由は issues)。
 * 実行は import_runs(source = external_api)に残し、何か変わっていれば顧客データの版数を上げる
 * (画面・予定計算のキャッシュを読み直させる)。INFO `integration.customers.ingested`(飛ばした・直したものがあれば WARN)。
 */
export async function ingestIntegrationCustomers(
  deps: IntegrationCustomersDeps,
  key: AuthenticatedIntegrationKey,
  customers: IntegrationCustomer[],
  meta: RequestMeta = {},
): Promise<IntegrationCustomersResponse> {
  const runId = newId();
  const now = deps.now?.() ?? new Date();
  const outcome = await deps.uow.run(key.tenantId, async (r) => {
    await r.importRuns.start({
      id: runId,
      source: 'external_api',
      fileName: null,
      fileVersion: null,
      triggeredBy: null,
    });
    const counts: Record<SnapshotOutcome, number> = { created: 0, updated: 0, unchanged: 0, skipped: 0 };
    const issueCounts: Partial<Record<CustomerSnapshotIssue, number>> = {};
    const results: IntegrationCustomersResponse['results'] = [];
    for (const customer of customers) {
      const issues: CustomerSnapshotIssue[] = [];
      const result = await applyCustomerSnapshot(
        { runId, onIssue: (issue) => issues.push(issue) },
        r,
        integrationCustomerToSnapshot(key.customerSource, customer),
        now,
      );
      counts[result]++;
      for (const issue of issues) issueCounts[issue] = (issueCounts[issue] ?? 0) + 1;
      results.push({ externalId: customer.externalId, outcome: result, issues });
    }
    const changed = counts.created + counts.updated > 0;
    const dataVersion = changed
      ? await r.settings.bumpCustomerDataVersion()
      : (await r.settings.get()).customerDataVersion;
    await r.importRuns.finish(runId, {
      status: 'applied',
      counts: {
        ...counts,
        ...Object.fromEntries(Object.entries(issueCounts).map(([issue, n]) => [`issue_${issue}`, n])),
      },
      message: null,
    });
    return { counts, issueCounts, results, dataVersion };
  });
  const hasIssues = outcome.counts.skipped > 0 || Object.keys(outcome.issueCounts).length > 0;
  await deps.appLog.write({
    tenantId: key.tenantId,
    level: hasIssues ? 'WARN' : 'INFO',
    action: 'integration.customers.ingested',
    actorType: 'system',
    details: {
      apiKeyId: key.apiKeyId,
      customerSource: key.customerSource,
      importRunId: runId,
      received: customers.length,
      ...outcome.counts,
      issues: outcome.issueCounts,
    },
    ...meta,
  });
  return {
    importRunId: runId,
    counts: outcome.counts,
    results: outcome.results,
    dataVersion: String(outcome.dataVersion),
  };
}
