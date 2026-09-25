import type { Options } from 'postgres';

/** postgres.js に渡す接続先(URL)と追加オプション。 */
export interface PostgresConnectionConfig {
  url: string;
  options: Options<Record<string, never>>;
}

/** プールの設定に使う環境変数(未指定なら既定値)。 */
export interface PoolEnv {
  /** 1プロセスあたりの最大接続数(既定10)。 */
  DB_POOL_MAX?: string;
  /** 使われていない接続を閉じるまでの秒数(既定60)。0で閉じない。 */
  DB_IDLE_TIMEOUT_SEC?: string;
  /** 接続の最大寿命(秒)。未指定なら postgres.js の既定(30〜60分のランダム)。 */
  DB_MAX_LIFETIME_SEC?: string;
}

const DEFAULT_POSTGRES_PORT = '5432';

function positiveInt(
  name: string,
  raw: string | undefined,
  fallback: number | undefined,
): number | undefined {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} は0以上の整数にしてください(値: ${raw})`);
  return value;
}

/**
 * DATABASE_URL を postgres.js の接続設定に変換する。
 *
 * Cloud Run の Cloud SQL 接続(Unix ソケット)は libpq と同じ
 * `postgres://USER:PASS@/DB?host=/cloudsql/PROJECT:REGION:INSTANCE` の形で書くのが一般的だが、
 * postgres.js はホスト部が空のURLを解釈できず(WHATWG URL として不正)、`host` クエリも
 * ホストとしては扱わない(接続パラメータとしてサーバーへ送ってしまう)。そのため `host` クエリが
 * `/` で始まる場合はここで取り出し、ソケットのパス(`<dir>/.s.PGSQL.<port>`)として `path` に渡す。
 * それ以外の形式(TCP の `postgres://USER:PASS@HOST:5432/DB?sslmode=require` 等)はそのまま渡す。
 */
export function buildPostgresConnection(url: string, env: PoolEnv = {}): PostgresConnectionConfig {
  const options: Options<Record<string, never>> = {
    max: positiveInt('DB_POOL_MAX', env.DB_POOL_MAX, 10),
    idle_timeout: positiveInt('DB_IDLE_TIMEOUT_SEC', env.DB_IDLE_TIMEOUT_SEC, 60),
    // 出勤簿・勤怠の日付は全てJST基準の業務日として扱う
    connection: { TimeZone: 'Asia/Tokyo' },
  };
  const maxLifetime = positiveInt('DB_MAX_LIFETIME_SEC', env.DB_MAX_LIFETIME_SEC, undefined);
  if (maxLifetime !== undefined) options.max_lifetime = maxLifetime;

  const socket = extractSocketHost(url);
  if (!socket) return { url, options };
  options.path = `${socket.dir}/.s.PGSQL.${socket.port}`;
  return { url: socket.urlWithoutSocket, options };
}

/** `?host=/path` 形式(Unix ソケット)なら、ソケットのディレクトリ・ポートと、それを除いたURLを返す。 */
function extractSocketHost(url: string): { dir: string; port: string; urlWithoutSocket: string } | null {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return null;
  const queryStart = url.indexOf('?');
  if (queryStart < 0) return null;

  const query = new URLSearchParams(url.slice(queryStart + 1));
  const host = query.get('host');
  if (!host?.startsWith('/')) return null;
  query.delete('host');

  // ホスト部が空(`@/db`)だと URL として不正なため、postgres.js に渡す URL は仮のホスト(localhost)で
  // 補う(実際の接続先は options.path のソケットで、ホストは使われない)。
  const beforeQuery = url.slice(0, queryStart);
  const authorityStart = schemeEnd + 3;
  const pathStart = beforeQuery.indexOf('/', authorityStart);
  const authority = beforeQuery.slice(authorityStart, pathStart < 0 ? undefined : pathStart);
  const at = authority.lastIndexOf('@');
  const port = /:(\d+)$/.exec(authority.slice(at + 1))?.[1] ?? '';
  const credentials = at >= 0 ? authority.slice(0, at + 1) : '';
  const rest = pathStart < 0 ? '' : beforeQuery.slice(pathStart);
  const remainingQuery = query.toString();

  return {
    dir: host.replace(/\/+$/, ''),
    port: port || DEFAULT_POSTGRES_PORT,
    urlWithoutSocket: `${url.slice(0, authorityStart)}${credentials}localhost${port ? `:${port}` : ''}${rest}${
      remainingQuery ? `?${remainingQuery}` : ''
    }`,
  };
}
