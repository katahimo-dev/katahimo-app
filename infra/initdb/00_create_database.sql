-- ローカルの PostgreSQL に開発用のロールとデータベースを作る。スーパーユーザー(postgres)で1回だけ実行する:
--   psql -U postgres -h localhost -f infra/initdb/00_create_database.sql [-v dbname=katahimo_dev]
-- 続けて 01_bootstrap.sql を同じデータベースに対して流す(Docker の場合はコンテナが自動で行う)。
--
-- ロール(クラスタ全体で共有。同じサーバーに複数のデータベースを作っても1組でよい):
--   katahimo_owner    NOLOGIN。全てのテーブル・関数の所有者(マイグレーションはこのロールで流れる)
--   katahimo_migrator LOGIN。katahimo_owner のメンバーで、ログインすると自動で SET ROLE katahimo_owner になる
--                     (MIGRATION_DATABASE_URL)
--   katahimo_app      LOGIN。API(DATABASE_URL)
--   katahimo_worker   LOGIN。ワーカー・ジョブ(WORKER_DATABASE_URL)。outbox はテナントを横断して取れる
--   katahimo_readonly NOLOGIN。将来の分析・調査用の入れ物(今は何も読めない)
-- どのロールも SUPERUSER・BYPASSRLS を持たない(テナント分離を RLS に任せる)。

\set ON_ERROR_STOP on
\if :{?dbname}
\else
  \set dbname katahimo_dev
\endif

SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_owner') AS create_owner \gset
\if :create_owner
  CREATE ROLE katahimo_owner NOLOGIN;
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_migrator') AS create_migrator \gset
\if :create_migrator
  CREATE ROLE katahimo_migrator LOGIN PASSWORD 'katahimo_migrator' IN ROLE katahimo_owner;
\endif
ALTER ROLE katahimo_migrator SET role = 'katahimo_owner';
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_app') AS create_app \gset
\if :create_app
  CREATE ROLE katahimo_app LOGIN PASSWORD 'katahimo_app';
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_worker') AS create_worker \gset
\if :create_worker
  CREATE ROLE katahimo_worker LOGIN PASSWORD 'katahimo_worker';
\endif
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_readonly') AS create_readonly \gset
\if :create_readonly
  CREATE ROLE katahimo_readonly NOLOGIN;
\endif

SELECT format('CREATE DATABASE %I OWNER katahimo_owner', :'dbname')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'dbname')\gexec
