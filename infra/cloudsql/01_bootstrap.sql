-- Cloud SQL for PostgreSQL の初期化 ②: katahimo データベース側の権限(infra/initdb/01_bootstrap.sql の本番版)。
-- 00_roles_and_database.sql の後に、同じ postgres ユーザーでデータベース katahimo に接続して実行する:
--
--   psql "host=127.0.0.1 port=5432 user=postgres dbname=katahimo" -f infra/cloudsql/01_bootstrap.sql
--
-- マイグレーション(Cloud Run Job migrate)より前に実行すること。テーブルごとの権限はマイグレーション
-- (0001_baseline_custom.sql)が明示的に付ける(既定権限は使わない)。何度実行してもよい。

\set ON_ERROR_STOP on

-- EXCLUDE 制約(期間の重なりの禁止)に必須。Cloud SQL の対応拡張に含まれる(trusted extension のため
-- 所有者でも作れるが、管理ユーザーが先に作っておく)。
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 接続できるロールを限る
REVOKE ALL ON DATABASE katahimo FROM PUBLIC;
GRANT CONNECT ON DATABASE katahimo TO katahimo_migrator, katahimo_app, katahimo_worker, katahimo_readonly;
-- 所有者はスキーマ(platform・drizzle)を作れる
GRANT CREATE ON DATABASE katahimo TO katahimo_owner;

-- public スキーマは所有者だけがオブジェクトを作れる(アプリ・ワーカーに DDL をさせない)
ALTER SCHEMA public OWNER TO katahimo_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
