import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { closeDatabase, createDatabase } from '@katahimo/db';
import { importLegacyReports } from '@katahimo/ingestion';
import { createLegacySheetsReaders } from '@katahimo/integrations';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { LEGACY_REPORTS_USAGE, parseLegacyReportsArgs } from './legacyImportArgs';
import { formatCounts, printIssues } from './legacyImportOutput';

/**
 * GAS版の「日報」「事故報告」シートを Google Sheets API で読み、日報・事故報告・ヒヤリハットを取り込む(移行の取込。
 * doc/09_移行計画.md)。全ての行が対象で、何度流してもよい(取込済みの行は作らず、シートで直された行だけを直す)。
 * 本アプリからのミラーの行(KatahimoReportId のある行)は取り込まない。ミラー・通知は積まない。
 * Google の認証は Application Default Credentials(運用担当者の ADC か、スプレッドシートを共有したサービスアカウント)。
 *
 * 使い方: pnpm import:legacy-reports -- <slug> --spreadsheet <ID> [--daily-sheet <名前>] [--accident-sheet <名前>] [--dry-run]
 */
async function main() {
  const parsed = parseLegacyReportsArgs();
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${LEGACY_REPORTS_USAGE}`);
    process.exit(1);
  }
  const args = parsed.value;
  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, db);
    const tenant = await container.tenants.findBySlug(args.slug);
    if (!tenant) throw new Error(`テナントが見つかりません: ${args.slug}`);
    const { sheets } = createLegacySheetsReaders();
    const result = await importLegacyReports(
      { uow: container.uow, appLog: container.appLog, sheets },
      {
        tenantId: tenant.id,
        spreadsheetId: args.spreadsheetId,
        dailySheetName: args.dailySheetName,
        accidentSheetName: args.accidentSheetName,
        dryRun: args.dryRun,
      },
    );
    console.log(
      `[import] GAS版の日報・事故報告を${args.dryRun ? '確かめました(dry-run: 書き込みません)' : '取り込みました'}${result.runId ? `(取込の実行 ${result.runId})` : ''}`,
    );
    console.log(formatCounts('gas_daily_report', result.counts.gas_daily_report, result.dryRun));
    console.log(formatCounts('gas_accident_report', result.counts.gas_accident_report, result.dryRun));
    printIssues(result.issues);
    for (const missing of result.missingFromSheet) {
      console.warn(
        `[import] ${missing.source === 'gas_daily_report' ? '日報' : '事故報告'}: 取込済みの記録 ${missing.careRecordId} の行が今のシートにありません(シートで行を消したか、日時・担当・顧客・開始時刻を直した。報告一覧で確かめます)`,
      );
    }
    const counts = Object.values(result.counts);
    if (counts.some((c) => c.errors > 0)) process.exitCode = 1;
  } finally {
    await closeDatabase(db);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
