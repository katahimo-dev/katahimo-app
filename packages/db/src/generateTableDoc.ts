import { loadDotenv } from './loadDotenv';

loadDotenv();

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { parseSchemaDocs, renderTable, type SchemaDocs, type TableCatalog } from './tableDoc';

/**
 * doc/03_付録_テーブル定義.md を作り直す(pnpm db:doc)。マイグレーション済みの DB(MIGRATION_DATABASE_URL。
 * 所有者なので全ての権限の付与が見える)のカタログを読む。スキーマを変えたら db:migrate の後に流してコミットする。
 */
const GROUPS: { file: string; title: string }[] = [
  { file: 'platform.ts', title: 'プラットフォーム(platform スキーマ。RLS なし)' },
  { file: 'tenancy.ts', title: 'テナントの設定・鍵・取込の記録' },
  { file: 'staff.ts', title: 'スタッフ・認証' },
  { file: 'customers.ts', title: '顧客・子ども' },
  { file: 'attendance.ts', title: '勤怠(出勤簿)' },
  { file: 'records.ts', title: '活動記録・領収書・ファイル・AIプロンプト' },
  { file: 'push.ts', title: '通知(Web Push)' },
  { file: 'outbox.ts', title: '非同期処理・変更履歴' },
  { file: 'appLogs.ts', title: '操作ログ(月のパーティション)' },
  { file: 'lifecycle.ts', title: 'データのライフサイクル(表だけ)' },
  { file: 'services.ts', title: '予約・割当(将来のマッチング。表だけ)' },
  { file: 'matching.ts', title: 'マッチングの入力と結果(表だけ)' },
];

const dir = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL が必要です(マイグレーション済みの DB のカタログを読みます)');
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => undefined });

async function readCatalog(schema: string, name: string): Promise<TableCatalog> {
  const [table] = await sql<{ oid: number; rls: boolean; force: boolean }[]>`
    select c.oid, c.relrowsecurity as rls, c.relforcerowsecurity as force
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and c.relname = ${name}`;
  if (!table)
    throw new Error(`テーブルがありません: ${schema}.${name}(db:migrate 済みの DB か確かめてください)`);
  const columns = await sql<TableCatalog['columns']>`
    select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as "notNull",
           pg_get_expr(d.adbin, d.adrelid) as default
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = ${table.oid} and a.attnum > 0 and not a.attisdropped order by a.attnum`;
  const constraints = await sql<TableCatalog['constraints']>`
    select conname as name, contype as type, pg_get_constraintdef(oid) as definition from pg_constraint
    where conrelid = ${table.oid} order by contype, conname`;
  const indexes = await sql<TableCatalog['indexes']>`
    select i.relname as name, pg_get_indexdef(i.oid) as definition
    from pg_index x join pg_class i on i.oid = x.indexrelid
    where x.indrelid = ${table.oid}
      and not exists (select 1 from pg_constraint k where k.conindid = x.indexrelid and k.conrelid = x.indrelid)
    order by 1`;
  const triggers = await sql<{ name: string }[]>`
    select tgname as name from pg_trigger where tgrelid = ${table.oid} and not tgisinternal order by 1`;
  const policies = await sql<{ name: string }[]>`
    select polname as name from pg_policy where polrelid = ${table.oid} order by 1`;
  const grants = await sql<{ grantee: string; privileges: string }[]>`
    select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
    from information_schema.role_table_grants
    where table_schema = ${schema} and table_name = ${name}
      and grantee in ('katahimo_app', 'katahimo_worker', 'katahimo_readonly')
    group by grantee`;
  // 列ごとの権限(GRANT UPDATE (列, …) ON …)。表の権限とは別に pg_attribute.attacl にある
  const columnGrants = await sql<{ grantee: string; privilege: string; columns: string[] }[]>`
    select g.grantee::regrole::text as grantee, g.privilege_type as privilege,
           array_agg(a.attname::text order by a.attnum) as columns
    from pg_attribute a cross join lateral aclexplode(a.attacl) g
    where a.attrelid = ${table.oid} and a.attnum > 0 and not a.attisdropped
      and g.grantee::regrole::text in ('katahimo_app', 'katahimo_worker', 'katahimo_readonly')
    group by 1, 2 order by 1, 2`;
  const columnGrantsOf: TableCatalog['columnGrants'] = {};
  for (const g of columnGrants) {
    columnGrantsOf[g.grantee] = { ...columnGrantsOf[g.grantee], [g.privilege]: g.columns };
  }
  return {
    schema,
    name,
    rls: table.rls,
    force: table.force,
    columns: [...columns],
    constraints: [...constraints],
    indexes: [...indexes],
    triggers: triggers.map((t) => t.name),
    policies: policies.map((p) => p.name),
    grants: Object.fromEntries(grants.map((g) => [g.grantee, g.privileges])),
    columnGrants: columnGrantsOf,
  };
}

async function main() {
  const sections: string[] = [];
  let count = 0;
  for (const group of GROUPS) {
    const folder = group.file === 'appLogs.ts' ? './customTables/' : './schema/';
    const docs: SchemaDocs = parseSchemaDocs(readFileSync(dir(`${folder}${group.file}`), 'utf8'));
    const schema = group.file === 'platform.ts' ? 'platform' : 'public';
    const blocks: string[] = [];
    for (const [name, doc] of Object.entries(docs)) {
      blocks.push(renderTable(await readCatalog(schema, name), doc));
      count++;
    }
    sections.push(`## ${group.title}\n\n${blocks.join('\n')}`);
  }
  const header = [
    '# 付録: テーブル定義',
    '',
    '> このファイルは `pnpm db:doc`(`packages/db/src/generateTableDoc.ts`)が、マイグレーション済みの DB のカタログと',
    '> `packages/db/src/schema/*.ts` の JSDoc から作る。**手で直さない**(説明はスキーマの JSDoc を直してから作り直す)。',
    '',
    '- 目的: 全テーブルの列・型・NULL・既定値・制約・索引・トリガー・RLS・アプリ/ワーカーの権限を一覧にする。',
    '- 対象読者: DB を変更・レビューする開発者、運用者。設計の考え方は [03_データベース設計.md](03_データベース設計.md)。',
    '- 省略: 全テーブル共通の `tenant_id → platform.tenants(id) ON DELETE CASCADE` の FK。権限の app は `katahimo_app`(API)、',
    '  worker は `katahimo_worker`。`katahimo_readonly` にはどの表の権限も無い。`UPDATE(列, …)` は列ごとの権限(その列だけ変えられる)。',
    `- テーブル数: ${count}(\`app_logs\` の月のパーティションは除く)。`,
    '',
  ].join('\n');
  const out = dir('../../../doc/03_付録_テーブル定義.md');
  writeFileSync(out, `${header}\n${sections.join('\n')}`);
  console.log(`テーブル定義を書き出しました(${count} テーブル): ${out}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
