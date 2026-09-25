import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { buildPostgresConnection } from './connection';

/** postgres.js が実際に解釈した接続先(接続はしない)。 */
function parsedBy(url: string, env = {}) {
  const { url: resolved, options } = buildPostgresConnection(url, env);
  const sql = postgres(resolved, options);
  const o = sql.options;
  return { path: o.path, host: o.host, port: o.port, database: o.database, user: o.user, pass: o.pass, o };
}

describe('buildPostgresConnection', () => {
  it('Cloud Run の Cloud SQL 接続(Unix ソケット)形式をソケットのパスに変換する', () => {
    const url =
      'postgres://katahimo_app:p%40ss%2Fw0rd@/katahimo?host=/cloudsql/my-proj:asia-northeast1:katahimo-db';
    // 変換しないと postgres.js はこの形式を解釈できない(前提の確認)
    expect(() => postgres(url)).toThrow();

    const parsed = parsedBy(url);
    expect(parsed.path).toBe('/cloudsql/my-proj:asia-northeast1:katahimo-db/.s.PGSQL.5432');
    expect(parsed.database).toBe('katahimo');
    expect(parsed.user).toBe('katahimo_app');
    expect(parsed.pass).toBe('p@ss/w0rd');
    // host クエリを接続パラメータ(サーバーへ送る設定値)として残さない
    expect(parsed.o.connection).toEqual({ application_name: 'postgres.js', TimeZone: 'Asia/Tokyo' });
  });

  it('ソケット形式でもポートと他のクエリ(application_name等)は保つ', () => {
    const parsed = parsedBy('postgres://u:p@:6432/db?application_name=katahimo-api&host=/tmp/');
    expect(parsed.path).toBe('/tmp/.s.PGSQL.6432');
    expect(parsed.database).toBe('db');
    expect(parsed.o.connection).toMatchObject({ application_name: 'katahimo-api' });
  });

  it('TCP のURLは変換せずにそのまま渡す(sslmode も postgres.js が解釈する)', () => {
    const url = 'postgres://katahimo_app:secret@10.0.0.3:5432/katahimo?sslmode=require';
    const { url: resolved, options } = buildPostgresConnection(url);
    expect(resolved).toBe(url);
    expect(options.path).toBeUndefined();

    const parsed = parsedBy(url);
    expect(parsed.host).toEqual(['10.0.0.3']);
    expect(parsed.port).toEqual([5432]);
    expect(parsed.o.ssl).toBe('require');
    expect(parsed.path).toBe(false);
  });

  it('プールの大きさ・アイドル切断・寿命を環境変数で調整できる', () => {
    const { options } = buildPostgresConnection('postgres://u:p@localhost/db', {
      DB_POOL_MAX: '4',
      DB_IDLE_TIMEOUT_SEC: '0',
      DB_MAX_LIFETIME_SEC: '900',
    });
    expect(options).toMatchObject({ max: 4, idle_timeout: 0, max_lifetime: 900 });

    const defaults = buildPostgresConnection('postgres://u:p@localhost/db').options;
    expect(defaults).toMatchObject({ max: 10, idle_timeout: 60 });
    expect(defaults.max_lifetime).toBeUndefined();
  });

  it('不正なプール設定は起動時に落とす', () => {
    expect(() => buildPostgresConnection('postgres://u:p@localhost/db', { DB_POOL_MAX: 'ten' })).toThrow(
      /DB_POOL_MAX/,
    );
  });
});
