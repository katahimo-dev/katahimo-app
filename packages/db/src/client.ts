import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { buildPostgresConnection } from './connection';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;
/** トランザクション(withTenant / UoW の中で repositories が使う接続)。 */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** 読み書きに使える接続(プール全体またはトランザクション)。 */
export type Executor = Database | Tx;

/**
 * 接続プールを作る。Cloud SQL の Unix ソケット形式の URL(`?host=/cloudsql/...`)にも対応する
 * (connection.ts)。プールの大きさは DB_POOL_MAX 等で調整する(doc/07_インフラ・運用.md 2.1)。
 */
export function createDatabase(
  connectionString: string,
  overrides: { max?: number; onnotice?: (notice: unknown) => void } = {},
) {
  const { url, options } = buildPostgresConnection(connectionString, process.env);
  const client = postgres(url, { ...options, ...overrides });
  return drizzle(client, { schema, casing: 'snake_case' });
}

let singleton: Database | null = null;

/** プロセス全体で1つのプールを共有する(url 省略時は DATABASE_URL)。 */
export function getDatabase(url: string | undefined = process.env.DATABASE_URL): Database {
  if (singleton) return singleton;
  if (!url) throw new Error('DATABASE_URL が設定されていません(.env.example を参照)');
  singleton = createDatabase(url);
  return singleton;
}

/** プールを閉じる(終了処理)。処理中の問い合わせは timeoutSec まで待つ。 */
export async function closeDatabase(db: Database, timeoutSec = 5): Promise<void> {
  await db.$client.end({ timeout: timeoutSec });
  if (singleton === db) singleton = null;
}

export interface TenantContextOptions {
  /** 操作したスタッフ(記録の変更履歴のトリガーが app.actor_id として読む)。 */
  actorId?: string | null;
}

/**
 * テナントスコープでクエリを実行する。
 *
 * 全テーブルに Row Level Security(FORCE)を張り、ポリシーは app_current_tenant()
 * (= current_setting('app.tenant_id'))と突き合わせる。アプリの WHERE 句の書き忘れでは他テナントの
 * データが漏れない、という保証を DB に持たせる。set_config(..., true) はトランザクションの中だけ有効なため、
 * プールの接続が使い回されても設定が残らない。
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  options: TenantContextOptions = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.actor_id', ${options.actorId ?? ''}, true)`,
    );
    return fn(tx);
  });
}
