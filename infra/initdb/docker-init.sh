#!/bin/sh
# infra/docker-compose.yml の PostgreSQL コンテナが最初の起動時に1回だけ実行する(docker-entrypoint-initdb.d)。
# 00(ロール・データベース)→ 01(データベース側の権限)を流す。マイグレーションはその後 pnpm db:migrate で流す。
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v dbname=katahimo_dev \
  -f /katahimo-initdb/00_create_database.sql
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname katahimo_dev -f /katahimo-initdb/01_bootstrap.sql
