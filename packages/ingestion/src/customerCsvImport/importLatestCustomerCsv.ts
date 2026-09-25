import { isNewerCustomerCsvVersion, pickLatestCustomerCsv } from '@katahimo/core/domain';
import type {
  AppLogPort,
  CustomerCsvSourcePort,
  CustomerCsvSourceTenant,
  CustomerImportStateRepositoryPort,
} from '@katahimo/core/ports';
import type { CustomerDeps } from '@katahimo/core/usecases';
import type { CustomerCsvImportStatus } from '@katahimo/shared';
import { parseReservaCsv } from '../reservaCsv/parse';
import { applyReservaImportPlan, planReservaImport } from '../reservaCsv/plan';

export interface CustomerCsvImportDeps extends CustomerDeps {
  csvSource: CustomerCsvSourcePort;
  importState: CustomerImportStateRepositoryPort;
  appLog: AppLogPort;
  now?: () => Date;
}

export interface CustomerCsvImportRequest {
  tenant: CustomerCsvSourceTenant;
  /** true なら取込済みの版でも取り込み直す(GAS版 forceImportCsv)。消失率の安全装置は外さない。 */
  force?: boolean;
  /** 手動実行した管理者。定期実行(Cloud Scheduler)はnull。 */
  actor?: { staffId: string; name: string } | null;
}

export interface CustomerCsvImportResult {
  status: CustomerCsvImportStatus;
  message: string;
  fileName: string | null;
  version: string | null;
  stats: {
    created: number;
    updated: number;
    deactivated: number;
    existingActiveCount: number;
    incomingCount: number;
    deactivateRatio: number;
  } | null;
  dataVersion: string;
}

/**
 * 取込元フォルダの最新の顧客CSVを、まだ取り込んでいなければ取り込む
 * (GAS版 CsvImport.js の checkAndImportLatestCsv。毎日3時の定期実行と管理者の手動実行で使う)。
 *
 * GAS版は顧客DBシートを丸ごと書き換えていたが、こちらは外部ID(RESERVA顧客ID)での差分適用
 * (planReservaImport / applyReservaImportPlan)を使い、CSVから消えた顧客が多すぎる場合は
 * 適用を止める安全装置もそのまま効かせる。取り込めたら版と data_version を更新する。
 */
export async function importLatestCustomerCsv(
  deps: CustomerCsvImportDeps,
  request: CustomerCsvImportRequest,
): Promise<CustomerCsvImportResult> {
  const { tenant, force = false, actor = null } = request;
  const state = await deps.importState.get(tenant.id);
  const base = { fileName: null, version: null, stats: null, dataVersion: String(state.dataVersion) };
  const log = (level: 'INFO' | 'WARN' | 'ERROR', action: string, details: Record<string, unknown>) =>
    deps.appLog.write({
      tenantId: tenant.id,
      level,
      action,
      actorStaffId: actor?.staffId ?? null,
      details: { ...details, force, triggeredBy: actor?.name ?? 'system' },
    });

  let fileName: string | null = null;
  let version: string | null = null;
  try {
    const files = await deps.csvSource.listFiles(tenant);
    if (files === null) {
      return { ...base, status: 'not_configured', message: '顧客CSVの取込元が設定されていません。' };
    }
    const latest = pickLatestCustomerCsv(files);
    if (!latest) {
      return { ...base, status: 'no_files', message: '取込対象の顧客CSVが見つかりません。' };
    }
    fileName = latest.file.name;
    version = latest.version;
    if (!force && !isNewerCustomerCsvVersion(latest.version, state.lastImportedVersion)) {
      return { ...base, fileName, version, status: 'up_to_date', message: '最新の顧客CSVは取込済みです。' };
    }

    const rows = parseReservaCsv(await deps.csvSource.readFile(tenant, latest.file));
    if (rows.length === 0) throw new Error(`顧客CSVに顧客の行がありません: ${fileName}`);

    const plan = await planReservaImport(deps.customers, tenant.id, rows);
    const planStats = {
      existingActiveCount: plan.stats.existingActiveCount,
      incomingCount: plan.stats.incomingCount,
      deactivateRatio: plan.stats.changedRatio,
    };
    if (plan.requiresReview) {
      const message =
        `顧客CSVから消えた顧客が多すぎるため取り込みを中止しました(消失${plan.stats.deactivateCount}件 / ` +
        `既存${plan.stats.existingActiveCount}件)。CSVの内容を確認してください。`;
      await log('WARN', 'customer_csv.import_review_required', { fileName, version, ...plan.stats });
      return {
        ...base,
        fileName,
        version,
        status: 'review_required',
        message,
        stats: { created: 0, updated: 0, deactivated: 0, ...planStats },
      };
    }

    const applied = await applyReservaImportPlan(deps, tenant.id, plan);
    const nextState = await deps.importState.recordImport(
      tenant.id,
      latest.version,
      deps.now?.() ?? new Date(),
    );
    await log('INFO', 'customer_csv.imported', { fileName, version, ...applied });
    return {
      status: 'imported',
      message: `顧客CSVを取り込みました: ${fileName}`,
      fileName,
      version,
      stats: { ...applied, ...planStats },
      dataVersion: String(nextState.dataVersion),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await log('ERROR', 'customer_csv.import_failed', { fileName, version, error: reason });
    return {
      ...base,
      fileName,
      version,
      status: 'failed',
      message: `顧客CSVの取込に失敗しました: ${reason}`,
    };
  }
}
