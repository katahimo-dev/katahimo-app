import {
  CUSTOMER_IMPORT_BUSY_REASON,
  isDomainError,
  isNewerCustomerCsvVersion,
  pickLatestCustomerCsv,
} from '@katahimo/core/domain';
import type { AppLogPort, CustomerCsvSourcePort, CustomerCsvSourceTenant } from '@katahimo/core/ports';
import type { CustomerCsvImportStatus } from '@katahimo/shared';
import { parseReservaCsv } from '../reservaCsv/parse';
import type { ReservaImportDeps } from '../reservaCsv/plan';
import { applyReservaImport } from '../reservaCsv/plan';

export interface CustomerCsvImportDeps extends ReservaImportDeps {
  csvSource: CustomerCsvSourcePort;
  appLog: AppLogPort;
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
    archived: number;
    existingActiveCount: number;
    incomingCount: number;
    missingRatio: number;
  } | null;
  dataVersion: string;
  /**
   * review_required のうち、前の取込で安全装置が止めた版をそのまま返したもの(ファイルを読まず、記録も残さない)。
   * 定期実行(10分ごと)が同じCSVで失敗・警告を繰り返さないように、ジョブはこれを失敗に数えない。
   */
  repeatedReview?: boolean;
}

/**
 * 取込元フォルダの最新の顧客CSVを、まだ取り込んでいなければ取り込む
 * (GAS版 CsvImport.js の checkAndImportLatestCsv。10分ごとの定期実行と、コーディネーター・管理者の手動実行で使う)。
 *
 * GAS版は顧客DBシートを丸ごと書き換えていたが、こちらは外部ID(RESERVA顧客ID)での差分適用
 * (applyReservaImport)を使い、CSVから消えた顧客が多すぎる場合は適用を止める安全装置もそのまま効かせる。
 * 取込済みの版は import_runs(最後に適用した取込)、data_version は tenant_settings.customer_data_version。
 * 取込元はテナントの設定(platform.tenants.customer_import_settings の Drive のフォルダ。運用担当者が
 * `pnpm tenant:customer-source` で設定する)。設定の無いテナントは not_configured(ローカル開発の
 * CUSTOMER_CSV_LOCAL_DIR を除く)。
 */
export async function importLatestCustomerCsv(
  deps: CustomerCsvImportDeps,
  request: CustomerCsvImportRequest,
): Promise<CustomerCsvImportResult> {
  const { tenant, force = false, actor = null } = request;
  const state = await deps.uow.run(tenant.id, async (r) => ({
    lastImportedVersion: (await r.importRuns.latestApplied('reserva_csv'))?.fileVersion ?? null,
    lastFinished: await r.importRuns.latestFinished('reserva_csv'),
    dataVersion: (await r.settings.get()).customerDataVersion,
    settings: await r.customerImportSettings(),
  }));
  const location = { tenant, settings: state.settings };
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
    const files = await deps.csvSource.listFiles(location);
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
    if (
      !force &&
      state.lastFinished?.status === 'review_required' &&
      state.lastFinished.fileVersion === latest.version
    ) {
      // 前の取込で安全装置が止めた版。新しいCSVが置かれるか、管理者が force で取り込み直すまで同じ結果になる
      return {
        ...base,
        fileName,
        version,
        status: 'review_required',
        message:
          `この顧客CSV(${fileName})は、消えた顧客が多すぎるため取り込みを止めています。` +
          'CSVの内容を確認し、正しいCSVをファイル名の日時が新しいものとして置いてください' +
          '(同じ日時のファイル名で置き直しても読み直しません。急ぐときは管理者に取り込み直しを頼んでください)。',
        repeatedReview: true,
      };
    }

    const rows = parseReservaCsv(await deps.csvSource.readFile(location, latest.file));
    if (rows.length === 0) throw new Error(`顧客CSVに顧客の行がありません: ${fileName}`);

    const outcome = await applyReservaImport(deps, tenant.id, rows, {
      fileName,
      fileVersion: version,
      triggeredBy: actor?.staffId ?? null,
    });
    const { plan } = outcome;
    const planStats = {
      existingActiveCount: plan.stats.existingActiveCount,
      incomingCount: plan.stats.incomingCount,
      missingRatio: plan.stats.missingRatio,
    };
    if (outcome.status === 'review_required') {
      const message =
        `顧客CSVから消えた顧客が多すぎるため取り込みを中止しました(消失${plan.stats.archiveCount}件 / ` +
        `既存${plan.stats.existingActiveCount}件)。CSVの内容を確認してください。`;
      await log('WARN', 'customer_csv.import_review_required', { fileName, version, ...plan.stats });
      return {
        ...base,
        fileName,
        version,
        status: 'review_required',
        message,
        stats: { created: 0, updated: 0, archived: 0, ...planStats },
      };
    }
    const applied = { created: outcome.created, updated: outcome.updated, archived: outcome.archived };
    await log(
      outcome.skipped > 0 || Object.keys(outcome.issues).length > 0 ? 'WARN' : 'INFO',
      'customer_csv.imported',
      {
        fileName,
        version,
        unchanged: outcome.unchanged,
        skipped: outcome.skipped,
        issues: outcome.issues,
        ...applied,
      },
    );
    return {
      status: 'imported',
      message: `顧客CSVを取り込みました: ${fileName}`,
      fileName,
      version,
      stats: { ...applied, ...planStats },
      dataVersion: String(outcome.customerDataVersion),
    };
  } catch (error) {
    if (isDomainError(error) && error.reason === CUSTOMER_IMPORT_BUSY_REASON) {
      // 他の取込(外部連携の API 等)が長くロックを持っていた。何も書いていないため、送り直せば通る
      await log('WARN', 'customer_csv.import_failed', { fileName, version, error: error.reason });
      return { ...base, fileName, version, status: 'busy', message: error.message };
    }
    // 原因(Drive・CSV の読み取りのエラー)は操作ログだけに残し、画面には出さない(外部サービスの詳細を見せない)
    const reason = error instanceof Error ? error.message : String(error);
    await log('ERROR', 'customer_csv.import_failed', { fileName, version, error: reason });
    return {
      ...base,
      fileName,
      version,
      status: 'failed',
      message:
        '顧客CSVの取込に失敗しました。しばらくしてからもう一度お試しください(続くときは管理者へ連絡してください)。',
    };
  }
}
