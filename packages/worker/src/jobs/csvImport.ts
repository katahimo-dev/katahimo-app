import { type CustomerCsvImportResult, importLatestCustomerCsv } from '@katahimo/ingestion';
import type { WorkerContainer } from '../container';
import { logJson } from './log';

export interface CsvImportJobTenantResult extends CustomerCsvImportResult {
  tenant: string;
}

/**
 * 顧客CSVの自動取込(GAS版 checkAndImportLatestCsv の定期実行)。推奨: 毎日03:00 JST
 * (22時の出勤簿反映より前に顧客住所を最新化しておくため)。新しいCSVが無ければ何もしない。
 * 取込失敗・要確認(消失率超過)があれば失敗扱い(終了コード1)にする。
 */
export async function runCsvImportJob(
  container: WorkerContainer,
): Promise<{ ok: boolean; results: CsvImportJobTenantResult[] }> {
  const results: CsvImportJobTenantResult[] = [];
  for (const tenant of await container.tenants.listActive()) {
    const result = await importLatestCustomerCsv(container, { tenant });
    results.push({ tenant: tenant.slug, ...result });
  }
  const ok = results.every((r) => r.status !== 'failed' && r.status !== 'review_required');
  logJson(ok ? 'INFO' : 'ERROR', '顧客CSVの自動取込が終わりました', {
    results: results.map((r) => ({
      tenant: r.tenant,
      status: r.status,
      fileName: r.fileName,
      version: r.version,
      stats: r.stats,
      dataVersion: r.dataVersion,
    })),
  });
  return { ok, results };
}
