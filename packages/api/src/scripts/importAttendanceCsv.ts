import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { readFileSync } from 'node:fs';
import { normalizeEmailForIndex } from '@katahimo/core/domain';
import { importAttendanceSheetRows } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { parseAttendanceSheetCsv } from '@katahimo/ingestion';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { cliArgs, resolveInputPath, takeOption } from './cliArgs';

/**
 * 既存の個別出勤簿(月のシート)を CSV に書き出したものを、スタッフの出勤簿(attendance_days 等)に取り込む
 * (本番への切り替え前に、当月分の出勤簿の内容を DB に揃える。doc/09_移行計画.md)。1日ずつ差分で書き、同じ内容の
 * 再実行は何も書かない。スプレッドシートへのミラーは積まない。
 *
 * 使い方: pnpm --filter @katahimo/api import:attendance -- <tenantSlug> <スタッフのログインメール> <CSVファイルパス> [--year YYYY]
 * (--year は A列の日付に年が無い表記('9/1' 等)の場合の年)
 */
async function main() {
  const { rest, value: yearArg } = takeOption(cliArgs(), '--year');
  const year = yearArg === undefined ? undefined : Number(yearArg);
  const [tenantSlug, email, csvArg] = rest;
  if (!tenantSlug || !email || !csvArg || (year !== undefined && !Number.isInteger(year))) {
    console.error(
      '使い方: pnpm --filter @katahimo/api import:attendance -- <tenantSlug> <スタッフのログインメール> <CSVファイルパス> [--year YYYY]',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const db = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, db);
    const tenant = await container.tenants.findBySlug(tenantSlug);
    if (!tenant) throw new Error(`テナントが見つかりません: ${tenantSlug}`);
    const staff = await container.uow.run(tenant.id, (r) =>
      r.staff.findByLoginEmail(normalizeEmailForIndex(email)),
    );
    if (!staff) throw new Error(`スタッフが見つかりません: ${email}`);

    const parsed = parseAttendanceSheetCsv(
      readFileSync(resolveInputPath(csvArg), 'utf8'),
      year === undefined ? {} : { year },
    );
    console.log(
      `[import] ${staff.displayName}: CSVから ${parsed.rows.length} 日分を読みました(日付でない行 ${parsed.ignoredRowCount} 行は読み飛ばし)`,
    );
    const result = await importAttendanceSheetRows(container, tenant.id, staff.id, parsed.rows);
    console.log(
      `[import] 取込 ${result.imported}日 / 変更なし ${result.unchanged}日 / 失敗 ${result.failed.length}日 / 読めないセル ${result.skippedCells.length}`,
    );
    for (const c of result.skippedCells)
      console.warn(`[import] ${c.rowNumber}行目 ${c.column}列を飛ばしました: ${c.message}`);
    for (const f of result.failed)
      console.error(`[import] ${f.rowNumber}行目(${f.businessDate})を取り込めません: ${f.message}`);
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    await closeDatabase(db);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
