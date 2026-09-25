import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { readFileSync } from 'node:fs';
import { getDatabase } from '@katahimo/db';
import { applyReservaImportPlan, parseReservaCsv, planReservaImport } from '@katahimo/ingestion';
import { createContainer } from '../container';
import { loadEnv } from '../env';

/**
 * RESERVA顧客CSVを実際に取り込むための操作スクリプト。
 * 使い方: pnpm --filter @katahimo/api import:reserva -- <tenantSlug> <CSVファイルパス> [--force]
 *
 * 差分計算(planReservaImport)は読み取り専用。消失率が閾値を超える場合は
 * --force を付けない限り適用を拒否する(安全装置。packages/ingestion/src/reservaCsv/plan.ts参照)。
 */
async function main() {
  const [tenantSlug, csvPath, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');

  if (!tenantSlug || !csvPath) {
    console.error(
      '使い方: pnpm --filter @katahimo/api import:reserva -- <tenantSlug> <CSVファイルパス> [--force]',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const db = getDatabase();
  const container = createContainer(env, db);

  const tenant = await container.tenants.findBySlug(tenantSlug);
  if (!tenant) {
    console.error(`テナントが見つかりません: ${tenantSlug}`);
    process.exit(1);
  }

  const buffer = readFileSync(csvPath);
  const rows = parseReservaCsv(buffer);
  console.log(`[import] CSVから ${rows.length} 件の顧客行をパースしました`);

  const plan = await planReservaImport(container.customers, tenant.id, rows);
  console.log('[import] 差分計画:', JSON.stringify(plan.stats, null, 2));

  if (plan.requiresReview && !force) {
    console.error(
      `[import] 消失率が閾値を超えているため適用を中止しました(消失${plan.stats.deactivateCount}件 / 既存${plan.stats.existingActiveCount}件)。` +
        '内容を確認のうえ、問題なければ --force を付けて再実行してください。',
    );
    process.exit(1);
  }

  const result = await applyReservaImportPlan(container, tenant.id, plan, { force });
  console.log('[import] 適用結果:', JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
