import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { importStaffMasterRows } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { parseStaffMasterCsv } from '@katahimo/ingestion';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { cliArgs, resolveInputPath } from './cliArgs';

/**
 * GAS版スタッフ台帳(Staffシート)をCSVに書き出したものを一括取込する。メールアドレス(E列)で照合し、
 * 既存スタッフは更新、いなければ作成する。GAS版のパスワードハッシュ(J列)はそのまま移行し、
 * 初回ログイン時にargon2idへ自動で移し替わる(LEGACY_AUTH_SALTの設定が必要)。
 *
 * 使い方: pnpm --filter @katahimo/api import:staff-master -- <tenantSlug> <CSVファイルパス> [--dry-run]
 */
async function main() {
  const [tenantSlug, csvArg, ...rest] = cliArgs();
  const dryRun = rest.includes('--dry-run');
  if (!tenantSlug || !csvArg) {
    console.error(
      '使い方: pnpm --filter @katahimo/api import:staff-master -- <tenantSlug> <CSVファイルパス> [--dry-run]',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    await run(env, createContainer(env, db), tenantSlug, resolveInputPath(csvArg), dryRun);
  } finally {
    await closeDatabase(db);
  }
}

async function run(
  env: ReturnType<typeof loadEnv>,
  container: ReturnType<typeof createContainer>,
  tenantSlug: string,
  csvPath: string,
  dryRun: boolean,
) {
  const tenant = await container.tenants.findBySlug(tenantSlug);
  if (!tenant) throw new Error(`テナントが見つかりません: ${tenantSlug}`);

  const parsed = parseStaffMasterCsv(readFileSync(csvPath, 'utf8'));
  for (const w of parsed.warnings) console.warn(`[import] ${w.rowNumber}行目: ${w.message}`);
  console.log(
    `[import] CSVから ${parsed.rows.length} 行を読み込みました${dryRun ? '(dry-run: 書き込みません)' : ''}`,
  );

  const result = await importStaffMasterRows(container, tenant.id, parsed.rows, {
    dryRun,
    fileName: basename(csvPath),
  });
  console.log(
    `[import] 作成 ${result.created}件 / 更新 ${result.updated}件 / スキップ ${result.skipped.length}件`,
  );
  for (const s of result.skipped) console.warn(`[import] ${s.rowNumber}行目をスキップ: ${s.reason}`);
  if (!env.LEGACY_AUTH_SALT) {
    console.warn('[import] LEGACY_AUTH_SALT が未設定です。GAS版のパスワードのままではログインできません。');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
