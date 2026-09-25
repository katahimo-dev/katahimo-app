import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDatabase>;

let singleton: Database | null = null;

export function createDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    // Cloud Run は同時実行数が読めないので控えめに。ローカルでも十分。
    max: Number(process.env.DB_POOL_MAX ?? 10),
    // 出勤簿・勤怠の日付は全てJST基準の業務日として扱う
    connection: { TimeZone: 'Asia/Tokyo' },
  });
  return drizzle(client, { schema, casing: 'snake_case' });
}

/** プロセス全体で1つのプールを共有する。 */
export function getDatabase(): Database {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL が設定されていません(.env.example を参照)');
  singleton = createDatabase(url);
  return singleton;
}

/**
 * テナントスコープでクエリを実行する。
 *
 * 全テーブルに Row Level Security を張り、ポリシーは current_setting('app.tenant_id') と
 * 突き合わせる形にしてある(doc/07 第4章)。アプリ側のWHERE句の書き忘れでは
 * 他テナントのデータが漏れない、という保証をDBに持たせるのが狙い。
 *
 * SET LOCAL はトランザクション内でのみ有効なため、必ずトランザクションで包む。
 * プール接続が使い回されても設定が残らないので、漏れの心配がない。
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
