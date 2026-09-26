# katahimo-app

保育訪問(ベビーシッター)事業のスタッフ用 Web アプリ。Google Apps Script 版 `gas-childcare-visit-app`(1法人専用、
スプレッドシート・Drive・カレンダーが正データ)を、PostgreSQL を正データとする複数法人対応の Web アプリとして作り直したもの。
スタッフはスマホ(PWA)で、今日の予定とルート、お客様の情報、日報・事故報告・領収書、出勤簿を扱う。

- 画面は GAS版と**同じ見た目・文言・操作の流れ**、業務ロジックは GAS版と**同じ結果**(GAS版のコードを動かして一致を確かめている)。
- 中身は作り直し: PostgreSQL + Row Level Security のテナント分離、保存データの暗号化(CMEK)、Cookie セッション、操作ログ、Cloud Run での運用。
- GAS版のソースはサブモジュール `legacy/gas-childcare-visit-app`(読み取り専用。**仕様の正**)。

TypeScript・pnpm 11 のワークスペース(`packages/shared` / `core` / `db` / `integrations` / `ingestion` / `api` / `worker` / `web`、
`tools/gas-preview`)。構成は [doc/01_システム概要.md](doc/01_システム概要.md)。

## すぐに動かす

必要なもの: Node.js 22 以上、pnpm 11(`corepack enable`)、PostgreSQL 16 以上(または Docker)。

```bash
git clone --recurse-submodules https://github.com/katahimo-dev/katahimo-app.git && cd katahimo-app
pnpm install
psql -U postgres -h localhost -f infra/initdb/00_create_database.sql              # Docker なら docker compose -f infra/docker-compose.yml up -d(:5433)
psql -U postgres -h localhost -d katahimo_dev -f infra/initdb/01_bootstrap.sql
cp .env.example .env    # SECRET_BOX_LOCAL_KEY に64桁hexを入れる(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
pnpm db:migrate && pnpm db:seed
pnpm --filter @katahimo/api dev      # :8080
pnpm --filter @katahimo/web dev      # :5173 → http://localhost:5173/?t=demo(admin@example.com / admin1234)
```

確認: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`。詳しい手順・コマンドの一覧は [doc/08_開発ガイド.md](doc/08_開発ガイド.md)。

## 資料

設計資料の索引と読む順番は [doc/README.md](doc/README.md)(システム概要・機能仕様・DB・API・バッチと外部連携・セキュリティ・
インフラと運用・開発ガイド・移行計画・マッチング拡張)。画面の決まりは [packages/web/README.md](packages/web/README.md)、
GAS版との見比べは [tools/gas-preview/README.md](tools/gas-preview/README.md)、変更履歴は [CHANGELOG.md](CHANGELOG.md)。

## 運用方針

- 変更履歴は `CHANGELOG.md`(`## [Ver. x.y.z] - 日付`)。
- APIキー・秘密鍵・トークン・パスワードはソースに書かない(ローカルは `.env`、本番は Secret Manager)。
- コードコメント・資料・README・CHANGELOG・コミットメッセージは日本語。
