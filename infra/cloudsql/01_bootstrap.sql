-- Cloud SQL for PostgreSQL の初期化 ②: katahimo データベース側の権限(infra/initdb/01_bootstrap.sql の本番版)。
-- 00_roles_and_database.sql の後に、同じ postgres ユーザーでデータベース katahimo に接続して実行する:
--
--   psql "host=127.0.0.1 port=5432 user=postgres dbname=katahimo" -f infra/cloudsql/01_bootstrap.sql
--
-- マイグレーション(Cloud Run Job migrate)より前に実行すること。0001・0003 のマイグレーションが
-- katahimo_app の権限を調整する(app_logs の UPDATE/DELETE、tenants・tenant_keys の UPDATE/DELETE を外す)ため、
-- ロールと既定権限が先に要る。
-- 何度実行してもよい。

\set ON_ERROR_STOP on

-- 予約の二重登録防止に使う EXCLUDE USING gist 制約(doc/07 第5章)に必須。
-- Cloud SQL の対応拡張に含まれる。PostgreSQL 13 以降は trusted extension のため、マイグレーション
-- (0000 の先頭)でも所有者ロールが作成できるが、ここで管理ユーザーが先に作っておく。
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 接続できるのは所有者(katahimo)・アプリ(katahimo_app)と、katahimo のメンバー(postgres)だけにする。
REVOKE ALL ON DATABASE katahimo FROM PUBLIC;
GRANT CONNECT ON DATABASE katahimo TO katahimo_app;
GRANT USAGE ON SCHEMA public TO katahimo_app;

-- PostgreSQL 15 以降は public スキーマの所有者が pg_database_owner(= katahimo)になり、PUBLIC の
-- CREATE 権限も無い。それより古い版で作った場合に備えて明示する(アプリロールにDDLをさせない)。
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO katahimo;

-- 以後 katahimo が作るテーブルに、自動でアプリロールの権限を付ける(ローカルの 01_bootstrap.sql と同じ)
ALTER DEFAULT PRIVILEGES FOR ROLE katahimo IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO katahimo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE katahimo IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO katahimo_app;
