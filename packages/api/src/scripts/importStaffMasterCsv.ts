import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { readFileSync } from 'node:fs';
import { importStaffMasterRows } from '@katahimo/core';
import { getDatabase } from '@katahimo/db';
import { parseStaffMasterCsv } from '@katahimo/ingestion';
import { createContainer } from '../container';
import { loadEnv } from '../env';

/**
 * GAS版スタッフ台帳(Staffシート)をCSVに書き出したものを一括取込する。メールアドレス(E列)で照合し、
 * 既存スタッフは更新、いなければ作成する。GAS版のパスワードハッシュ(J列)はそのまま移行し、
 * 初回ログイン時にargon2idへ自動で移し替わる(LEGACY_AUTH_SALTの設定が必要)。
 *
 * 使い方: pnpm --filter @katahimo/api import:staff-master -- <tenantSlug> <CSVファイルパス> [--dry-run]
 */
async function main() {
  const [tenantSlug, csvPath, ...rest] = process.argv.slice(2).filter((a) => a !== '--');
  const dryRun = rest.includes('--dry-run');
  if (!tenantSlug || !csvPath) {
    console.error(
      '使い方: pnpm --filter @katahimo/api import:staff-master -- <tenantSlug> <CSVファイルパス> [--dry-run]',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const container = createContainer(env, getDatabase());
  const tenant = await container.tenants.findBySlug(tenantSlug);
  if (!tenant) {
    console.error(`テナントが見つかりません: ${tenantSlug}`);
    process.exit(1);
  }

  const parsed = parseStaffMasterCsv(readFileSync(csvPath, 'utf8'));
  for (const w of parsed.warnings) console.warn(`[import] ${w.rowNumber}行目: ${w.message}`);
  console.log(
    `[import] CSVから ${parsed.rows.length} 行を読み込みました${dryRun ? '(dry-run: 書き込みません)' : ''}`,
  );

  const result = await importStaffMasterRows(container, tenant.id, parsed.rows, { dryRun });
  console.log(
    `[import] 作成 ${result.created}件 / 更新 ${result.updated}件 / スキップ ${result.skipped.length}件`,
  );
  for (const s of result.skipped) console.warn(`[import] ${s.rowNumber}行目をスキップ: ${s.reason}`);
  if (!env.LEGACY_AUTH_SALT) {
    console.warn('[import] LEGACY_AUTH_SALT が未設定です。GAS版のパスワードのままではログインできません。');
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
