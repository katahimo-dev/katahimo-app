# katahimo-app

保育訪問(ベビーシッター)事業のスタッフ用Webアプリ。Google Apps Script 版 `gas-childcare-visit-app`
(Googleスプレッドシート・Drive・カレンダーを直接読み書きする1法人専用のWebアプリ)を、PostgreSQL を正データとする
複数法人(マルチテナント)対応のWebアプリとして作り直したもの。スタッフはスマホ(PWA)で、今日の予定とルート、
お客様の情報、日報・事故報告・領収書、出勤簿を扱う。

- 画面はGAS版と**同じ見た目・文言・操作の流れ**(GAS版に慣れたスタッフがそのまま使えるように)。
- 業務ロジックはGAS版と**同じ結果**(予定の分類・ルート・出勤簿の計算・カレンダー反映は、GAS版のコードそのものを
  テストの中で動かして出力の一致を確かめている)。
- 中身は作り直し: PostgreSQL + Row Level Security によるテナント分離、個人情報の暗号化、Cookie セッション、
  操作ログ、Cloud Run での運用。GAS / スプレッドシートへの依存は移行期のミラー書き込みだけに閉じ込めている。

## GAS版との関係

| 項目 | 内容 |
| --- | --- |
| GAS版のソース | `legacy/gas-childcare-visit-app`(git submodule → [`katahimo-dev/gas-childcare-visit-app`](https://github.com/katahimo-dev/gas-childcare-visit-app))。**仕様の正**。このリポジトリからは読み取り専用で、修正はGAS版リポジトリで行う |
| 画面 | GAS版 `index.html` が `google.script.run` で呼ぶ全機能を作り直し済み: ログイン・パスワード再設定/変更・設定(文字の大きさ・管理者の詳細設定)・今日/明日の予定とルート・お客様一覧/お客様の情報/これまでの記録・日報/事故報告/ヒヤリハット(AIの下書き)・領収書(OCR・重複確認・お客様の指定なし)・訪問終わりました・出勤簿(週/日表示・修正・カレンダーとの見比べと取り込み・まとめて取り込む・今月のまとめ)。`tools/gas-preview` で同じ場面(124場面)を撮って並べ、差分が 0.05% 以下であることを確かめている。意図的に変えた点は `packages/web/README.md` |
| サーバー処理 | 認証・日報・領収書・設定・スタッフ管理(`doc/api/auth-reports-settings.md`)、予定・ルート計算(`doc/api/schedule-route.md`)、出勤簿・カレンダー反映・夜間バッチ・顧客CSV取込(`doc/api/attendance-batch.md`)を移植済み。GAS版の穴(他人の日報を上書きできた等)は塞いである |
| 予定・ルート | Google Calendar API + Google Maps Platform(Geocoding / Routes)を直接呼ぶ(`SCHEDULE_PROVIDER=google`)。移行期はGAS版の Web App(`Bridge.js`)に任せることもできる(`gas_bridge`) |
| スプレッドシート | DBが正。出勤簿・勤怠集計・日報・事故報告・領収書は、GAS版の画面や他のGASプロジェクトが読む間だけ outbox → `Bridge.js` でミラー書き込みできる(`MIRROR_TO_GOOGLE_SHEETS`、既定は off。GAS側の書き込み action は未デプロイ) |
| まだ無いもの | 本番テナントと最初の管理者を作るスクリプト、スタッフの自宅住所・緯度経度を設定する画面、管理者向けのスタッフ管理・AIプロンプト編集の画面(APIのみ。GAS版にも画面は無い)、Google ログイン(`doc/11` 8章) |

### GAS版のトリガー(切替日に止めるもの・残すもの)

手順は [`doc/11_GCPデプロイ手順.md`](doc/11_GCPデプロイ手順.md) 7章。

| プロジェクト / トリガー | 新版での扱い |
| --- | --- |
| gas-childcare-visit-app `autoSyncTodayScheduleForAllStaff`(毎日22時台) | **切替日に止める**(`Triggers.js` で `enabled: false` → `setupAllTriggers()`)。新版の `job:nightly-calendar-sync`(22:00 JST)が代わる |
| gas-childcare-visit-app `checkAndImportLatestCsv`(毎日3時台) | **切替日に止める**。新版の `job:csv-import`(03:00 JST)が代わる |
| gas-childcare-visit-app `flushLogsToDrive`(10分おき) | GAS版の画面と Bridge を誰も使わなくなるまで**残す**(止める直前に一度手動実行する) |
| GAS版 Web App(`Bridge.js`) | ミラー書き込みか `SCHEDULE_PROVIDER=gas_bridge` を使う間は公開したままにする |
| gas-root-serach `autoRunSaveAttendance()` | visit-app で代替済み。残っていれば削除 |
| gas-root-serach `main()`(翌日のルート集計・LINE WORKS 通知) | 新版では代替していない。業務上不要と確認できた場合だけ削除 |
| gas-childcare-daily-report `autoRunDailyTransfer()` | 削除(勤怠集計 → 個別出勤簿の転記) |
| gas-integrated-system | Web App の公開を停止(廃止確認済み) |

## 構成

```mermaid
flowchart LR
  user[スタッフ・管理者<br/>スマホ / PWA] -->|HTTPS 同一オリジン<br/>Cookie セッション| api
  subgraph app[katahimo-app]
    web[packages/web<br/>React SPA]
    api[packages/api<br/>Hono API]
    worker[packages/worker<br/>outbox ポーラー / 夜間ジョブ]
    core[packages/core<br/>ドメイン・ユースケース・ポート]
    db[packages/db<br/>Drizzle・リポジトリ]
    integ[packages/integrations<br/>外部サービスの実装]
    ing[packages/ingestion<br/>CSV 取込]
    shared[packages/shared<br/>zod 契約・既定値]
  end
  api -. ビルド済みを配信 .-> web
  web -->|応答を検証| shared
  api -->|入力を検証| shared
  api --> core
  worker --> core
  api --> ing
  worker --> ing
  core --> db
  core --> integ
  db -->|withTenant + RLS| pg[(PostgreSQL)]
  integ --> gcal[Google Calendar API]
  integ --> maps[Maps Geocoding / Routes]
  integ --> gemini[Gemini API]
  integ --> store[(GCS / ローカル<br/>領収書画像)]
  integ --> kms[Cloud KMS / ローカル KEK]
  integ --> chat[Google Chat Webhook]
  integ --> drive[Google Drive<br/>顧客CSV]
  worker -->|outbox ミラー| bridge[GAS版 Bridge.js<br/>→ スプレッドシート]
```

本番は Cloud Run(API + Web画面 / outbox ワーカー / Cloud Run Jobs)+ Cloud SQL。構成図と手順は `doc/11`。

## パッケージ

| パッケージ | 役割 |
| --- | --- |
| `packages/shared` | API の zod 契約(`src/contracts/`。画面とAPIの両方で検証に使う)と既定値(AIプロンプト・評価の定義・パスワード規則) |
| `packages/core` | ドメイン(純粋関数: 出勤簿の列レイアウトと計算・月ロック・カレンダー反映、予定の分類とルート区間、個人情報の正規化と blind index、旧パスワードハッシュ、outbox の再試行間隔 等)、ポート(外部依存のインターフェース)、ユースケース |
| `packages/db` | Drizzle のスキーマ(`src/schema/`)・マイグレーション(`drizzle/`)・リポジトリ・`withTenant()`・接続(Cloud SQL の Unix ソケット対応) |
| `packages/integrations` | ポートの実装: Google Calendar / Maps / Gemini / Google Chat / Drive / GCS / Cloud KMS / SMTP、ローカル用(暗号・KMS・保存先)、noop、GAS Bridge、実装の選択(`schedule-provider` / `storage-provider` / `kms-provider`) |
| `packages/ingestion` | RESERVA 顧客CSV(UTF-16LE / Shift_JIS / UTF-8 を自動判定)・GAS版スタッフ台帳CSVの解析と取込、最新の顧客CSVの自動取込 |
| `packages/api` | Hono の API サーバー(`src/routes/`)、セッション(`src/session.ts`)、本番でのWeb画面の配信(`WEB_DIST_DIR`)、運用スクリプト(`src/scripts/`: seed・顧客CSV・スタッフ台帳の取込) |
| `packages/worker` | 常駐の outbox ポーラー(ミラー書き込みと再試行)と単発ジョブ(夜間カレンダー反映・顧客CSV取込・free/busy 同期・outbox 1回) |
| `packages/web` | スタッフ用Webアプリ(React 18 + Vite 6 + TanStack Query 5 + Tailwind CSS v3 + vite-plugin-pwa)。[`packages/web/README.md`](packages/web/README.md) |
| `tools/gas-preview` | GAS版と新アプリを同じ場面・同じデータで撮って並べる見比べハーネスと、実際のAPIでの通し確認(e2e)。[`tools/gas-preview/README.md`](tools/gas-preview/README.md) |
| `infra/` | ローカル用 PostgreSQL(`docker-compose.yml`・`initdb/`)、Cloud SQL 初期化SQL(`cloudsql/`)、Terraform(`gcp/`) |

## ローカル開発の始め方

必要なもの: Node.js 22 以上、pnpm 11(`package.json` の `packageManager`。`corepack enable` で入る)、
PostgreSQL 16 以上(直接インストール、または Docker)。

### 1. 取得と依存

```bash
git clone --recurse-submodules https://github.com/katahimo-dev/katahimo-app.git
cd katahimo-app
git submodule update --init     # 既に clone 済みで legacy/ が空のとき
pnpm install
```

`legacy/gas-childcare-visit-app` はテスト(GAS版との一致確認)と見比べハーネスが使う。GAS版の最新(main)に
追従するときは `git submodule update --remote legacy/gas-childcare-visit-app` のあと参照コミットを commit する。

### 2. データベース

ロールは2つ: テーブル所有者 `katahimo`(マイグレーション用)と、アプリが接続する非所有者 `katahimo_app`。
アプリは必ず `katahimo_app` で接続する(テナント分離を所有者の権限に頼らないため)。

**PostgreSQL を直接入れている場合**(ポート 5432):

```bash
psql -U postgres -h localhost -f infra/initdb/00_create_database.sql              # ロール katahimo と DB katahimo_dev
psql -U postgres -h localhost -d katahimo_dev -f infra/initdb/01_bootstrap.sql    # btree_gist・katahimo_app・既定権限
```

**Docker の場合**(ポート 5433。初期化SQLはコンテナが自動で流す):

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 3. `.env`

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # 2回実行し、下の2つに別々の値を入れる
```

最低限必要なのは次の値(ほかは空のままで動く。各項目の説明は `.env.example`)。

| キー | 値 |
| --- | --- |
| `DATABASE_URL` | `postgres://katahimo_app:katahimo_app@localhost:5432/katahimo_dev`(Docker なら `:5433`) |
| `MIGRATION_DATABASE_URL` | `postgres://katahimo:katahimo@localhost:5432/katahimo_dev`(同上) |
| `SESSION_SECRET` | 任意の文字列(本番は32文字以上) |
| `LOCAL_DEV_MASTER_KEY` | 64桁hex(blind index の鍵) |
| `LOCAL_DEV_KEK` | 64桁hex(テナント鍵をラップする鍵。`LOCAL_DEV_MASTER_KEY` とは別の値) |

空のままのときの動き: `SCHEDULE_PROVIDER` 未指定かつ Google の資格情報・GAS Bridge が無い → `noop`(予定は常に0件)、
`GEMINI_API_KEY` 無し → AIの下書き・OCRはGAS版と同じ「API Key Missing」の応答、`SMTP_HOST` 無し → パスワード再設定の
メールはワーカー(`pnpm worker`、outbox 経由で送る)の標準出力に出る、Webhook 無し → 通知しない、`STORAGE_PROVIDER=local` → 領収書画像は `LOCAL_RECEIPT_STORAGE_DIR`
(既定 `./data/receipts`、API の作業ディレクトリから)。一度決めた `LOCAL_DEV_MASTER_KEY` / `LOCAL_DEV_KEK` / `KMS_PROVIDER` は
変えない(既存の検索用インデックス・暗号文が読めなくなる)。

### 4. マイグレーションと開発用データ

```bash
pnpm db:migrate   # MIGRATION_DATABASE_URL(所有者)で packages/db/drizzle を適用
pnpm db:seed      # テナント demo・管理者 admin@example.com / admin1234・お客様3件(何度流してもよい)
```

実データの取込(運用スクリプト):

```bash
pnpm --filter @katahimo/api import:reserva -- <テナントslug> <顧客CSV> [--force]
pnpm --filter @katahimo/api import:staff-master -- <テナントslug> <スタッフ台帳CSV> [--dry-run]
```

### 5. 起動

```bash
pnpm --filter @katahimo/api dev      # API  http://localhost:8080(/api/health, /api/health/db)
pnpm --filter @katahimo/web dev      # 画面 http://localhost:5173(/api は :8080 へ中継)
pnpm worker                          # outbox ポーラー(ミラーを使うときだけ必要)
```

ブラウザで `http://localhost:5173/?t=demo` を開き、`admin@example.com` / `admin1234` でログインする
(法人IDの決め方は `packages/web/README.md`)。

**本番と同じ形**(API がビルド済みのWeb画面を同じオリジンで配信)で動かすには、`pnpm build` のあと
`WEB_DIST_DIR=<packages/web/dist の絶対パス>` を付けて `dist/server.js` を起動する。ただし `packages/*/dist` は外部依存を
バンドルしないため、ワークスペースの `node_modules`(pnpm の厳密な配置)からは動かない。`Dockerfile` と同じく、
本番依存を平坦に入れたディレクトリ(`pnpm install --prod --frozen-lockfile --config.node-linker=hoisted --filter '@katahimo/api...'`)
に `dist/` を置いて実行する(イメージのビルド手順は `doc/11`)。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | 全パッケージの `tsc --noEmit` |
| `pnpm test` | Vitest(`packages/*/src/**/*.test.ts`。GAS版との一致確認を含む。DBは使わない) |
| `pnpm lint` / `pnpm lint:fix` | Biome(`legacy/` は対象外) |
| `pnpm build` | api / worker / db(tsup)と web(vite)の本番ビルド |
| `pnpm db:generate` | スキーマ(`packages/db/src/schema`)の変更から差分マイグレーションを作る(drizzle-kit) |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio` | マイグレーション適用 / 開発用データ / Drizzle Studio |
| `pnpm worker` | 常駐ワーカー(outbox ポーラー。`WORKER_IN_PROCESS_CRON=true` で夜間ジョブも中で動かす) |
| `pnpm job:nightly-calendar-sync [-- YYYY-MM-DD]` | 全テナントの在籍スタッフの当日分をカレンダーから出勤簿へ反映(本番は 22:00 JST) |
| `pnpm job:csv-import` | 各テナントの最新の顧客CSVが未取込なら取り込む(本番は 03:00 JST。ローカルは `CUSTOMER_CSV_LOCAL_DIR=<dir>` の `<dir>/<テナントslug>/Kokyaku_YYYYMMDDHHmm_N.csv`) |
| `pnpm --filter @katahimo/worker job:sync-busy-blocks` | スタッフのカレンダーの free/busy を同期(将来のマッチング用) |
| `pnpm --filter @katahimo/worker outbox:once` | outbox を1回だけ処理して終わる |
| `pnpm --filter @katahimo/gas-preview shoot [-- --only <正規表現>]` | GAS版との見比べ(web 開発サーバーを起動しておく) |
| `pnpm --filter @katahimo/gas-preview e2e [-- --web-url …]` | 実際のAPI・DBでの通し確認(API と web を起動しておく) |

## 資料

| 資料 | 内容 |
| --- | --- |
| [`doc/07_技術構成提案書.md`](doc/07_技術構成提案書.md) | 技術選定の検討(DB・マルチテナント・予約・請求・カルテ・取込・移行・ホスティング・コスト) |
| [`doc/08_技術構成サマリー.md`](doc/08_技術構成サマリー.md) | 07 の要約(外部レビュー用) |
| [`doc/09_データベース構造解説.md`](doc/09_データベース構造解説.md) | スキーマの解説(RLS・複合FK・個人情報の暗号化と鍵の階層・テーブル一覧・出勤簿の `row_data`) |
| [`doc/10_マッチング拡張DB設計.md`](doc/10_マッチング拡張DB設計.md) | 次期の「管理者がスタッフを割り当てるアプリ」用のテーブル(複数法人・属性・勤務可能時間・busy・相性・予約と割当) |
| [`doc/11_GCPデプロイ手順.md`](doc/11_GCPデプロイ手順.md) | GCP 本番環境の構成・初回デプロイ・運用・コスト・GAS版からの切替チェックリスト |
| [`doc/api/auth-reports-settings.md`](doc/api/auth-reports-settings.md) | 認証・日報/事故報告・領収書・設定・スタッフ管理のAPI |
| [`doc/api/schedule-route.md`](doc/api/schedule-route.md) | 予定・ルート計算の実装・設定・キャッシュ・料金の目安 |
| [`doc/api/attendance-batch.md`](doc/api/attendance-batch.md) | 出勤簿・カレンダー反映・バッチ・顧客CSV取込のAPIと、GAS側(Bridge.js)に必要な変更 |
| [`packages/web/README.md`](packages/web/README.md) | 画面の作り方の決まり・フォルダ構成・localStorage のキー・z-index・GAS版と意図的に変えた点 |
| [`tools/gas-preview/README.md`](tools/gas-preview/README.md) | 見比べハーネスと通し確認の使い方 |
| [`CHANGELOG.md`](CHANGELOG.md) | 変更履歴 |

## 参考

- `legacy/gas-childcare-visit-app` — 稼働中のGAS版(仕様の正)。アプリ本体は `gas-childcare-visit-app/`。
  そのリポジトリの `CLAUDE.md` にファイルの対応表・管理者と本人の見分け方・キャッシュの層がまとまっている。
- 旧試作(`katahimo-dev/C001-cutest-internal` の `01_GAS/katahimo-app`、Hono + Drizzle + PostgreSQL)は、このリポジトリの
  土台として取り込み済み(画面は GAS版を正として作り直した)。その設計資料は `doc/07`〜`doc/09` に引き継いでおり、
  以前の `doc/reference/` は重複のため削除した。
- [`ohru131/katahimo-app`](https://github.com/ohru131/katahimo-app) — 公開デモ版。UI・設計の参考。

## 運用方針

- 変更履歴は `CHANGELOG.md` に記録する(`## [Ver. x.y.z] - 日付`)。
- APIキー・秘密鍵・トークン・パスワードはソースに直書きしない(ローカルは `.env`、本番は Secret Manager)。
- コードコメント・README・CHANGELOG・コミットメッセージは日本語で書く。
