-- データベース側の初期化(00_create_database.sql の後、マイグレーションより前)。スーパーユーザーで実行する:
--   psql -U postgres -h localhost -d katahimo_dev -f infra/initdb/01_bootstrap.sql
-- Docker 利用時は docker-entrypoint-initdb.d から自動実行される。何度実行してもよい。
-- テーブルごとの権限はマイグレーション(0001_baseline_custom.sql)が明示的に付ける(既定権限は使わない)。

\set ON_ERROR_STOP on

-- EXCLUDE 制約(二重予約・期間の重なりの禁止)に使う。trusted extension のため所有者でも作れるが先に作っておく。
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 接続できるロールを限る
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database())\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO katahimo_migrator, katahimo_app, katahimo_worker, katahimo_readonly',
              current_database())\gexec
-- 所有者はスキーマ(platform・drizzle)を作れる
SELECT format('GRANT CREATE ON DATABASE %I TO katahimo_owner', current_database())\gexec

-- public スキーマは所有者だけがオブジェクトを作れる(アプリ・ワーカーに DDL をさせない)
ALTER SCHEMA public OWNER TO katahimo_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
