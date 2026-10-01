import { type CustomerCsvImportResult, importLatestCustomerCsv } from '@katahimo/ingestion';
import type { WorkerContainer } from '../container';
import { logJson } from './log';

export interface CsvImportJobTenantResult extends CustomerCsvImportResult {
  tenant: string;
}

/**
 * 顧客CSVの自動取込(GAS版 checkAndImportLatestCsv の定期実行)。10分ごと(infra の var.customer_csv_import_schedule。
 * 新しいお客様は初回の訪問の直前に登録されることがあり、日報を書くまでに取り込むため)。新しいCSVが無ければ
 * フォルダの一覧を見るだけで終わる。
 * 取込失敗・要確認(消失率超過)があれば失敗扱い(終了コード1。Cloud Run Jobs が再試行する)にする。ただし前の取込で
 * 安全装置が止めた版をもう一度見ただけ(repeatedReview)と、他の取込が実行中(busy。手動の取込・外部連携の API)は
 * 失敗にしない(次の回が取り込む。同じ原因で10分ごとに失敗を繰り返さないように)。
 */
export async function runCsvImportJob(
  container: WorkerContainer,
): Promise<{ ok: boolean; results: CsvImportJobTenantResult[] }> {
  const results: CsvImportJobTenantResult[] = [];
  for (const tenant of await container.tenants.listActive()) {
    const result = await importLatestCustomerCsv(container, { tenant });
    results.push({ tenant: tenant.slug, ...result });
  }
  const ok = results.every(countsAsCsvImportSuccess);
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

/** ジョブを失敗(終了コード1)にしない結果か。busy と、前に止めた版をもう一度見ただけの review_required は失敗にしない。 */
export function countsAsCsvImportSuccess(result: CustomerCsvImportResult): boolean {
  if (result.status === 'failed') return false;
  if (result.status === 'review_required') return result.repeatedReview === true;
  return true;
}
