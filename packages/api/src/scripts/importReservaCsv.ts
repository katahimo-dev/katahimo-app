import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { CUSTOMER_CSV_FILE_PATTERN } from '@katahimo/core/domain';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { applyReservaImport, parseReservaCsv } from '@katahimo/ingestion';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { cliArgs, resolveInputPath } from './cliArgs';

/**
 * RESERVA の顧客CSVを取り込む操作スクリプト。
 * 使い方: pnpm --filter @katahimo/api import:reserva -- <tenantSlug> <CSVファイルパス> [--force]
 *
 * 1トランザクションで差分を適用する(作成・変わった項目だけの更新・消えた顧客のアーカイブ)。消えた顧客の
 * 割合が閾値を超える場合は --force を付けない限り適用しない(packages/ingestion/src/reservaCsv/plan.ts)。
 */
async function main() {
  const [tenantSlug, csvArg, ...rest] = cliArgs();
  const force = rest.includes('--force');
  if (!tenantSlug || !csvArg) {
    console.error(
      '使い方: pnpm --filter @katahimo/api import:reserva -- <tenantSlug> <CSVファイルパス> [--force]',
    );
    process.exit(1);
  }

  const csvPath = resolveInputPath(csvArg);
  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, db);
    const tenant = await container.tenants.findBySlug(tenantSlug);
    if (!tenant) throw new Error(`テナントが見つかりません: ${tenantSlug}`);

    const rows = parseReservaCsv(readFileSync(csvPath));
    console.log(`[import] CSVから ${rows.length} 件の顧客行を読みました`);
    const fileName = basename(csvPath);
    const outcome = await applyReservaImport(container, tenant.id, rows, {
      force,
      fileName,
      // RESERVA の名前(Kokyaku_YYYYMMDDHHmm.csv)なら版も残す。残さないと、10分ごとの定期の取込が取込元の同じ版を
      // 「未取込」とみなして取り込み直し、この手での取込を上書きする
      fileVersion: CUSTOMER_CSV_FILE_PATTERN.exec(fileName)?.[1] ?? null,
    });
    console.log('[import] 差分:', JSON.stringify(outcome.plan.stats));
    if (outcome.status === 'review_required') {
      console.error(
        `[import] 消えた顧客の割合が閾値を超えたため適用しませんでした(消失${outcome.plan.stats.archiveCount}件 / ` +
          `既存${outcome.plan.stats.existingActiveCount}件)。内容を確認のうえ、問題なければ --force を付けて再実行してください。`,
      );
      process.exitCode = 1;
      return;
    }
    const { created, updated, unchanged, archived, skipped, issues, customerDataVersion } = outcome;
    console.log(
      '[import] 適用結果:',
      JSON.stringify({ created, updated, unchanged, archived, skipped, issues, customerDataVersion }),
    );
  } finally {
    await closeDatabase(db);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
