-- Cloud SQL for PostgreSQL の初期化 ①: ロールとデータベースを作る(infra/initdb/00_create_database.sql の本番版)。
--
-- Cloud SQL には本当のスーパーユーザーが無い。組み込みの管理ユーザー postgres(cloudsqlsuperuser ロールの
-- メンバー。CREATEROLE / CREATEDB を持つ)で、データベース postgres に接続して1回実行する:
--
--   psql "host=127.0.0.1 port=5432 user=postgres dbname=postgres" \
--     -v migrator_password="$KATAHIMO_MIGRATOR_PASSWORD" \
--     -v app_password="$KATAHIMO_APP_PASSWORD" \
--     -v worker_password="$KATAHIMO_WORKER_PASSWORD" \
--     -f infra/cloudsql/00_roles_and_database.sql
--
-- (接続は Cloud SQL Auth Proxy 経由。doc/11_GCPデプロイ手順.md 「4. ロールの作成」)
-- 再実行すると3つのログインロールのパスワードを与えた値に設定し直す(パスワードのローテーションにも使える)。
--
-- ロール:
--   katahimo_owner    NOLOGIN。全てのテーブル・関数の所有者
--   katahimo_migrator LOGIN。katahimo_owner のメンバーで、ログインすると SET ROLE katahimo_owner になる
--                     (Cloud Run Job migrate・テナント作成の CLI。MIGRATION_DATABASE_URL)
--   katahimo_app      LOGIN。API(DATABASE_URL)
--   katahimo_worker   LOGIN。ワーカー・ジョブ(WORKER_DATABASE_URL)。outbox はテナントを横断して取れる
--   katahimo_readonly NOLOGIN。将来の分析・調査用の入れ物
-- ロールは gcloud sql users create / Terraform の google_sql_user では作らない。そちらで作ったユーザーは
-- 自動的に cloudsqlsuperuser のメンバー(CREATEROLE / CREATEDB 付き)になり、要らない権限が付いてしまうため、
-- ここで素の LOGIN ロールとして作る。

\set ON_ERROR_STOP on

\if :{?migrator_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'migrator_password が未指定です(-v migrator_password=...)'; END $$;
\endif
\if :{?app_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'app_password が未指定です(-v app_password=...)'; END $$;
\endif
\if :{?worker_password}
\else
  DO $$ BEGIN RAISE EXCEPTION 'worker_password が未指定です(-v worker_password=...)'; END $$;
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_owner') AS create_owner \gset
\if :create_owner
  CREATE ROLE katahimo_owner NOLOGIN;
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_migrator') AS create_migrator \gset
\if :create_migrator
  CREATE ROLE katahimo_migrator LOGIN PASSWORD :'migrator_password' IN ROLE katahimo_owner;
\else
  ALTER ROLE katahimo_migrator LOGIN PASSWORD :'migrator_password';
\endif
ALTER ROLE katahimo_migrator SET role = 'katahimo_owner';

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_app') AS create_app \gset
\if :create_app
  CREATE ROLE katahimo_app LOGIN PASSWORD :'app_password';
\else
  ALTER ROLE katahimo_app LOGIN PASSWORD :'app_password';
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_worker') AS create_worker \gset
\if :create_worker
  CREATE ROLE katahimo_worker LOGIN PASSWORD :'worker_password';
\else
  ALTER ROLE katahimo_worker LOGIN PASSWORD :'worker_password';
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_readonly') AS create_readonly \gset
\if :create_readonly
  CREATE ROLE katahimo_readonly NOLOGIN;
\endif

-- postgres(実行者)を katahimo_owner のメンバーにする。所有者を katahimo_owner にしたデータベースを作るため
-- (PostgreSQL 16 以降は所有者ロールに SET ROLE できることが必要)。アプリ・ワーカーには付けない。
GRANT katahimo_owner TO CURRENT_USER;

SELECT NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'katahimo') AS create_database \gset
\if :create_database
  CREATE DATABASE katahimo OWNER katahimo_owner;
\endif

-- ロールとDBが揃っていることの確認(rolsuper / rolbypassrls はどれも f のはず)
SELECT rolname, rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
FROM pg_roles WHERE rolname LIKE 'katahimo%' ORDER BY rolname;
SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'katahimo';
