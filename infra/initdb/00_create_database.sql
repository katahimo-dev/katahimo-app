-- ローカルにインストール済みのPostgreSQLに開発用のロール/DBを作る。
-- スーパーユーザー(postgres)で1回だけ実行する:
--   psql -U postgres -h localhost -f infra/initdb/00_create_database.sql
-- Docker(infra/docker-compose.yml)を使う場合はコンテナ側が同等の初期化を行うため実行不要。

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'katahimo') THEN
    CREATE ROLE katahimo LOGIN PASSWORD 'katahimo';
  END IF;
END
$$;

-- CREATE DATABASE は DO ブロック内で実行できないため \gexec で条件付き実行する
SELECT 'CREATE DATABASE katahimo_dev OWNER katahimo'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'katahimo_dev')\gexec
