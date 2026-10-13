# katahimo-app

保育訪問(ベビーシッター)事業のスタッフ用 Web アプリ。Google Apps Script 版 `gas-childcare-visit-app`(1法人専用、
スプレッドシート・Drive・カレンダーが正データ)を、PostgreSQL を正データとする複数法人対応の Web アプリとして作り直したもの。
スタッフはスマホ(PWA)で、今日の予定とルート、お客様の情報、日報・事故報告・領収書、出勤簿を扱う。

- 業務ロジックは GAS版と**同じ結果**(GAS版のコードを動かして一致を確かめている)。画面は GAS版を出発点にしたが、
  以後の変更はこのアプリの中だけで行い、GAS版との見た目の一致は求めない。
- 中身は作り直し: PostgreSQL + Row Level Security のテナント分離、保存データの暗号化(CMEK)、Cookie セッション、操作ログ、Cloud Run での運用。
- GAS版のソースはサブモジュール `legacy/gas-childcare-visit-app`(読み取り専用。**業務ロジックの仕様の正**)。

TypeScript・pnpm 11 のワークスペース(`packages/shared` / `core` / `db` / `integrations` / `ingestion` / `api` / `worker` / `web`、
`tools/e2e`)。構成は [doc/01_システム概要.md](doc/01_システム概要.md)。

## すぐに動かす

必要なもの: Node.js 22 以上、pnpm 11(`corepack enable`)、PostgreSQL 16 以上(または Docker)。

```bash
git clone --recurse-submodules https://github.com/katahimo-dev/katahimo-app.git && cd katahimo-app
pnpm install
psql -U postgres -h localhost -f infra/initdb/00_create_database.sql              # Docker なら docker compose -f infra/docker-compose.yml up -d(:5433)
psql -U postgres -h localhost -d katahimo_dev -f infra/initdb/01_bootstrap.sql
# 環境変数は Bitwarden Secrets Manager から入る(下の「環境変数」)。BWS_TOKEN_KATAHIMO を設定しておく
pnpm bws pnpm db:migrate && pnpm bws pnpm db:seed
pnpm dev     # API :8080 と 画面 :5173 → http://localhost:5173/?t=demo(admin@example.com / admin1234)
```

確認: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`。詳しい手順・コマンドの一覧は [doc/08_開発ガイド.md](doc/08_開発ガイド.md)。

## 環境変数

`.env` は使わない。[Bitwarden Secrets Manager](https://bitwarden.com/products/secrets-manager/) のプロジェクト
`katahimo` に置き、実行時に `scripts/bws-env.mjs` が環境変数として注入する。値がディスクに残らない。

```bash
winget install --id Bitwarden.BWS --exact      # bws CLI(初回のみ)
# ma-katahimo のアクセストークンを発行し、ユーザー環境変数に入れる(初回のみ。設定後はターミナルを開き直す)
[Environment]::SetEnvironmentVariable("BWS_TOKEN_KATAHIMO", "<token>", "User")   # PowerShell
```

| コマンド | 注入 |
| --- | --- |
| `pnpm dev` | あり(内部で `dev:raw` を呼ぶ) |
| `pnpm bws <コマンド>` | あり。包んでいないものはこれを前置(`pnpm bws pnpm db:migrate`) |
| `pnpm lint` / `typecheck` / `test` / `build` | なし(CI が同じコマンドで回るため包まない) |

キーを足すときは Bitwarden の `katahimo` プロジェクトに追加し、`.env.example`・`infra/gcp/run.tf`(本番)・資料も直す。
運用の全体像(トークンの発行・失効、他リポジトリとの関係)は非公開リポジトリ `ohru131/handbook` の `secrets/README.md`。

## 資料

設計資料の索引と読む順番は [doc/README.md](doc/README.md)(システム概要・機能仕様・DB・API・バッチと外部連携・セキュリティ・
インフラと運用・開発ガイド・移行計画・マッチング拡張)。画面の決まりは [packages/web/README.md](packages/web/README.md)、
変更履歴は [CHANGELOG.md](CHANGELOG.md)。

## 運用方針

- 変更履歴は `CHANGELOG.md`(`## [Ver. x.y.z] - 日付`)。
- APIキー・秘密鍵・トークン・パスワードはソースに書かない(ローカルは Bitwarden Secrets Manager、本番は Secret Manager)。
- コードコメント・資料・README・CHANGELOG・コミットメッセージは日本語。
