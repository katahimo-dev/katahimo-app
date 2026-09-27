import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { closeDatabase, createDatabase } from '@katahimo/db';
import { importLegacyReceipts } from '@katahimo/ingestion';
import { createLegacySheetsReaders } from '@katahimo/integrations';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import {
  LEGACY_RECEIPTS_USAGE,
  legacyReceiptsStorageProblem,
  parseLegacyReceiptsArgs,
} from './legacyImportArgs';
import { formatCounts, printIssues } from './legacyImportOutput';

/**
 * GAS版の「領収書一覧」を Google Sheets API で読み、指定の月の領収書を画像(Drive API)ごと取り込む(移行の取込。
 * doc/09_移行計画.md)。何度流してもよい(取込済みの画像は取り込まない)。本アプリからのミラーの行
 * (KatahimoReceiptId のある行)と、本アプリで登録済みの同じ内容の領収書は取り込まない。ミラー・通知は積まない。
 * 画像はファイル置き場に保存する。STORAGE_PROVIDER=gcs でなければ(dry-run と --allow-local-storage の開発を除いて)断る
 * (ローカルのファイル置き場は CLI を流した端末のディスクで、本番の API からは読めない)。
 *
 * 使い方: pnpm import:legacy-receipts -- <slug> --spreadsheet <ID> (--month YYYY-MM ... | --from YYYY-MM --to YYYY-MM) [--sheet <名前>] [--dry-run] [--allow-local-storage]
 */
async function main() {
  const parsed = parseLegacyReceiptsArgs();
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${LEGACY_RECEIPTS_USAGE}`);
    process.exit(1);
  }
  const args = parsed.value;
  const env = loadEnv();
  const storageProblem = legacyReceiptsStorageProblem(args, env.STORAGE_PROVIDER);
  if (storageProblem) {
    console.error(storageProblem);
    process.exit(1);
  }
  const db = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, db);
    const tenant = await container.tenants.findBySlug(args.slug);
    if (!tenant) throw new Error(`テナントが見つかりません: ${args.slug}`);
    const { sheets, drive } = createLegacySheetsReaders();
    const result = await importLegacyReceipts(
      { uow: container.uow, appLog: container.appLog, storage: container.storage, sheets, drive },
      {
        tenantId: tenant.id,
        spreadsheetId: args.spreadsheetId,
        sheetName: args.sheetName,
        months: args.months,
        dryRun: args.dryRun,
      },
    );
    console.log(
      `[import] GAS版の領収書(${args.months.join(', ')})を${args.dryRun ? '確かめました(dry-run: 書き込みません。画像は種類・大きさだけを見ます)' : '取り込みました'}${result.runId ? `(取込の実行 ${result.runId})` : ''}`,
    );
    console.log(formatCounts('gas_receipt', result.counts, result.dryRun));
    printIssues(result.issues);
    if (result.counts.errors > 0) process.exitCode = 1;
  } finally {
    await closeDatabase(db);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
