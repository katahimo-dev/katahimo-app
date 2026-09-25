-- Cloud SQL for PostgreSQL の初期化 ①: ロールとデータベースを作る(infra/initdb/00_create_database.sql の本番版)。
--
-- Cloud SQL には本当のスーパーユーザーが無い。組み込みの管理ユーザー postgres(cloudsqlsuperuser ロールの
-- メンバー。CREATEROLE / CREATEDB を持つ)で、データベース postgres に接続して1回実行する:
--
--   psql "host=127.0.0.1 port=5432 user=postgres dbname=postgres" \
--     -v owner_password="$KATAHIMO_OWNER_PASSWORD" -v app_password="$KATAHIMO_APP_PASSWORD" \
--     -f infra/cloudsql/00_roles_and_database.sql
--
-- (接続は Cloud SQL Auth Proxy 経由。doc/11_GCPデプロイ手順.md 「4. ロールの作成」)
-- 再実行すると2つのロールのパスワードを与えた値に設定し直す(パスワードのローテーションにも使える)。
--
-- ロールは gcloud sql users create / Terraform の google_sql_user では作らない。そちらで作ったユーザーは
-- 自動的に cloudsqlsuperuser のメンバー(CREATEROLE / CREATEDB 付き)になり、アプリ用ロールに要らない権限が
-- 付いてしまうため、ここで素の LOGIN ロールとして作る。

\set ON_ERROR_STOP on

\if :{?owner_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'owner_password が未指定です(-v owner_password=...)'; END $$;
\endif
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'app_password が未指定です(-v app_password=...)'; END $$;
\endif

-- テーブル所有者(マイグレーション用、MIGRATION_DATABASE_URL)
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo') AS create_owner \gset
\if :create_owner
  CREATE ROLE katahimo LOGIN PASSWORD :'owner_password';
\else
  ALTER ROLE katahimo LOGIN PASSWORD :'owner_password';
\endif

-- アプリ接続用(DATABASE_URL)。テーブル所有者とは分ける: 所有者はRLSを既定でバイパスするため、
-- 所有者で接続するとテナント分離が効かない(テーブル側も FORCE ROW LEVEL SECURITY 済み)。
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_app') AS create_app \gset
\if :create_app
  CREATE ROLE katahimo_app LOGIN PASSWORD :'app_password';
\else
  ALTER ROLE katahimo_app LOGIN PASSWORD :'app_password';
\endif

-- postgres(実行者)を katahimo のメンバーにする。所有者を katahimo にしたデータベースを作る
-- (PostgreSQL 16 以降は所有者ロールに SET ROLE できることが必要)ことと、01 の
-- ALTER DEFAULT PRIVILEGES FOR ROLE katahimo に必要。katahimo_app には付けない。
GRANT katahimo TO CURRENT_USER;

SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'katahimo') AS create_database \gset
\if :create_database
  CREATE DATABASE katahimo OWNER katahimo;
\endif

-- ロールとDBが揃っていることの確認(rolsuper / rolbypassrls はどちらも f のはず)
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles WHERE rolname IN ('katahimo', 'katahimo_app') ORDER BY rolname;
SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'katahimo';
