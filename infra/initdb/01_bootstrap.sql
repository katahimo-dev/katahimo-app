-- katahimo_dev データベース側の初期化。
-- スーパーユーザーで実行する:
--   psql -U postgres -h localhost -d katahimo_dev -f infra/initdb/01_bootstrap.sql
-- Docker利用時は docker-entrypoint-initdb.d から自動実行される。

-- 予約の二重登録防止に使う EXCLUDE USING gist 制約(doc/07 第5章)に必須
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- アプリ接続用ロール。テーブル所有者(katahimo)とは分ける。
-- テーブル所有者は RLS を既定でバイパスするため、所有者で接続するとテナント分離が効かない。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo_app') THEN
    CREATE ROLE katahimo_app LOGIN PASSWORD 'katahimo_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE katahimo_dev TO katahimo_app;
GRANT USAGE ON SCHEMA public TO katahimo_app;

-- 以後 katahimo が作るテーブルに、自動でアプリロールの権限を付ける
ALTER DEFAULT PRIVILEGES FOR ROLE katahimo IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO katahimo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE katahimo IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO katahimo_app;
