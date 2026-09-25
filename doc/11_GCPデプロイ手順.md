# 11. GCP(Cloud Run + Cloud SQL)デプロイ手順

katahimo-app を Google Cloud の本番環境に載せるための構成・初回デプロイ手順・運用・GAS版からの切替手順。
関連ファイル:

| ファイル | 内容 |
| --- | --- |
| `Dockerfile` / `.dockerignore` | イメージ2種(`--target api` / `--target worker`)。Node 22(ベースイメージはダイジェスト固定)・pnpm・マルチステージ・非rootユーザー(`node`)で実行 |
| `cloudbuild.yaml` | ビルド → push → マイグレーション(Cloud Run Job)→ デプロイ |
| `infra/gcp/*.tf` | Terraform(Cloud Run・Cloud SQL・Secret Manager・Artifact Registry・GCS・KMS・Scheduler・IAM・監視と予算 `monitoring.tf`)。プロバイダーの版とハッシュは `.terraform.lock.hcl` で固定 |
| `.github/workflows/ci.yml` / `infra.yml` | PR・main の CI(テスト・マイグレーションの差分チェック・ビルド)と Terraform の fmt / validate(README「CI とブランチ保護」) |
| `infra/cloudsql/*.sql` | Cloud SQL のロール・DB・権限の初期化(`infra/initdb/*.sql` の本番版) |
| `packages/db/src/connection.ts` | `DATABASE_URL`(Cloud SQL の Unix ソケット形式を含む)と接続プールの設定 |

> **確度について**: GCP の仕様・料金は執筆時点(2026-09)の記憶に基づく部分がある。「(要確認)」を付けた箇所は
> 公式ドキュメント・料金計算ツールで確かめてから進めること。Terraform は google provider 8.4 で
> `terraform validate` と(認証なしの)`terraform plan -refresh=false` まで通しているが、実環境への apply は未実施。
> 監視(`monitoring.tf`)のアラート条件の指標名・ラベルも、実際の指標が流れてから Monitoring のコンソールで
> 当たっていることを確かめること(要確認)。

## 1. 構成

```mermaid
flowchart LR
  user[スタッフ・管理者<br/>ブラウザ / PWA] -->|HTTPS| api
  subgraph run[Cloud Run asia-northeast1]
    api[katahimo-api<br/>サービス: API + Web画面<br/>min 0 / max 3]
    worker[katahimo-worker<br/>サービス: outbox ポーラー<br/>min=max=1, ingress internal]
    jobs[Cloud Run Jobs<br/>migrate / nightly-calendar-sync /<br/>csv-import / sync-busy-blocks]
  end
  sched[Cloud Scheduler<br/>22:00 / 03:00 JST] -->|jobs.run| jobs
  api & worker & jobs -->|Unix ソケット /cloudsql| sql[(Cloud SQL<br/>PostgreSQL)]
  api -->|領収書画像| gcs[(GCS<br/>receipts バケット)]
  worker -->|読み取り| gcs
  api & worker & jobs -->|DEK の wrap/unwrap| kms[Cloud KMS<br/>tenant-kek]
  sm[Secret Manager] -.環境変数.-> api & worker & jobs
  api & jobs -->|ADC| gapi[Google Calendar / Drive API]
  api & jobs -->|API キー| maps[Maps Geocoding / Routes]
  api -->|API キー| gemini[Gemini API]
  worker -->|GAS_BRIDGE_URL| gas[GAS版 Web App<br/>Bridge.js → Sheets/Drive]
  api & worker & jobs -->|1行JSON| logging[Cloud Logging]
  cb[Cloud Build] -->|push| ar[(Artifact Registry)]
  ar --> run
```

- **api**: Hono の API と、`packages/web` をビルドした SPA を同じサービス・同じオリジンで配信する(セッション
  Cookie をそのまま使うため)。`/api/*` が常に優先で、それ以外は `WEB_DIST_DIR` の静的ファイル、拡張子の無い
  パスは `index.html`(SPA フォールバック)。キャッシュ: `assets/*`・`workbox-<hash>.js` は1年 immutable、
  `index.html`・`sw.js`・`registerSW.js`・`manifest.webmanifest` は `no-cache`、その他は1時間
  (`packages/api/src/http/webStatic.ts`)。
- **worker**: outbox ミラー(GAS 版スプレッドシート/Drive への書き込み)の常駐ポーラー。Cloud Run サービスは
  ポートで待ち受ける必要があるため、`WORKER_HEALTH_PORT` で最小限のヘルスチェック応答だけを返す。
  外部からは呼べない(ingress internal・IAM 認証あり)。パスワード再設定メールも outbox 経由でワーカーが送る
  (API は応答時間からアカウントの有無が分からないよう送らない)ため、本番では常に動かす
  (`outbox_poller_enabled = true`。SMTP の設定・`smtp-pass` はワーカーに渡す)。
- **jobs**: 同じ worker イメージの別コマンド(`node dist/<job>.js`、migrate は `node db/dist/migrate.js`)。
  失敗すると終了コード1になり、Cloud Run Jobs の再試行とアラートに乗る。
- **鍵**: テナントごとの DEK は Cloud KMS の `tenant-kek` でラップして DB(`tenant_keys`)に保存する
  (`KMS_PROVIDER=gcp`、`CloudKmsPort`)。blind index の HMAC 鍵(`LOCAL_DEV_MASTER_KEY`、名前は開発用だが
  本番も使う)は Secret Manager に置く。`LOCAL_DEV_KEK` は本番では使わない。
- **本番の起動時検証**: `NODE_ENV=production` のとき、API・ワーカーとも次を満たさなければ起動前に落ちる:
  `KMS_PROVIDER=gcp` + `GCP_KMS_KEY_NAME`、`STORAGE_PROVIDER=gcs` + `GCS_BUCKET`、`SCHEDULE_PROVIDER` の明示、
  (ワーカーのみ)`SMTP_HOST`、(API のみ)32文字以上の `SESSION_SECRET`。

### DB 接続方式

Cloud Run の「Cloud SQL 接続」(サービス/ジョブに `cloud_sql_instance` ボリュームを付ける)を使い、
`/cloudsql/<接続名>/.s.PGSQL.5432` の Unix ソケットで接続する。暗号化と IAM による接続の許可は Cloud Run 側の
Auth Proxy が行うため、アプリ側に TLS 設定は要らない。

```
DATABASE_URL=postgres://katahimo_app:<パスワード>@/katahimo?host=/cloudsql/<プロジェクト>:asia-northeast1:katahimo-db
```

postgres.js はこの形式(ホスト部が空・`host` クエリ)をそのままでは解釈できない(`Invalid URL` になる)ため、
`packages/db/src/connection.ts` が `host=/...` を取り出してソケットのパスに変換する(`connection.test.ts` で
変換結果を postgres.js 自身に解釈させて確認している)。

- インスタンスはパブリックIPを持つが承認済みネットワークを登録しないため、Auth Proxy / Cloud SQL コネクタ
  以外からは接続できない。直接の TCP 接続には TLS 必須(`ssl_mode = ENCRYPTED_ONLY`)。
- **パブリックIPへ直接 TCP で繋ぐ場合**(非推奨): `?sslmode=require` で暗号化はされるが、サーバー証明書は
  検証されない(postgres.js の `require` は検証なし)。検証するにはインスタンスのサーバーCA証明書を
  `ssl: { ca }` で渡す実装が別途必要(未実装)。
- **プライベートIP**にする場合は VPC・Direct VPC egress(またはサーバーレス VPC アクセス)が必要になり構成が
  増えるため、今回は採用していない。
- **Cloud SQL Node.js コネクタ(`@google-cloud/cloud-sql-connector`)/ IAM データベース認証**: パスワードを
  持たずに実行SAで DB にログインできるが、コネクタは pg / mysql2 / tedious 向けで、postgres.js では `socket`
  オプションにコネクタのストリームを渡す自前の結合が要る(要確認)。Cloud Run 組み込みの Cloud SQL 接続は
  IAM 自動認証に対応していない(要確認)。現状はパスワード認証(Secret Manager)で十分なため採用しない。

### 接続数の見積もり

postgres.js のプールは1プロセスあたり `DB_POOL_MAX` 本(既定10)。アイドル接続は `DB_IDLE_TIMEOUT_SEC`
(既定60秒)で閉じる。Cloud Run は1インスタンスで同時に最大80リクエストを処理するが、DB 接続は
`DB_POOL_MAX` 本を使い回す(足りない間はクエリが待つ)。

| 利用元 | 設定(infra/gcp/run.tf) | 最大接続数 |
| --- | --- | --- |
| api | `api_max_instances`(3)× `api_db_pool_max`(5) | 15 |
| worker(常駐) | 1 × 3 | 3 |
| 夜間ジョブ | 1 × 3(同時に動くのは通常1つ) | 3 |
| migrate | 1 × 1 | 1 |
| 運用者(psql 等) | | 数本 |

合計を Cloud SQL の `max_connections` 未満に保つ。`db-g1-small` の既定は 50 程度(要確認。
`SHOW max_connections;` で確認できる)。API を増やすときは `api_max_instances × api_db_pool_max` を見直す。

RLS との関係: `withTenant()`(`packages/db/src/client.ts`)はトランザクション内で
`set_config('app.tenant_id', …, true)`(= `SET LOCAL`)を使うため、設定はトランザクション終了で消え、
プールの接続が別テナントのリクエストに使い回されても漏れない。トランザクションモードの接続プーラー
(PgBouncer / Cloud SQL のマネージド接続プーリング)を前に置いても同じ理由で安全だが、postgres.js の
プリペアドステートメントとの相性を確認すること(現構成では使わない)。

## 2. 事前準備

- GCP プロジェクト(請求先アカウントを紐付け)と、`Owner` 相当の権限を持つ作業者アカウント。
- 作業環境: Cloud Shell(`gcloud`・`psql`・`terraform` が入っている。`cloud-sql-proxy` も入っている(要確認)。
  無ければ [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/sql-proxy) を取得)。
- 変数(以下のコマンドで使う):

```bash
export PROJECT_ID=<プロジェクトID>
export REGION=asia-northeast1
gcloud config set project "$PROJECT_ID"
```

- Terraform の state 用バケット(state には構成情報が入るため、他と共用せずアクセスを絞る):

```bash
gcloud storage buckets create "gs://${PROJECT_ID}-tfstate" --location="$REGION" \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://${PROJECT_ID}-tfstate" --versioning
```

## 3. 初回デプロイ

### 3.1 基盤を作る(Terraform、`deploy_workloads = false`)

```bash
cd infra/gcp
cp terraform.tfvars.example terraform.tfvars   # project_id・smtp・customer_csv_drive_folders 等を編集
terraform init -backend-config="bucket=${PROJECT_ID}-tfstate"
terraform apply        # API 有効化・Cloud SQL・Secret Manager(入れ物)・Artifact Registry・GCS・KMS・SA
terraform output       # sql_connection_name・service_accounts などを控える
```

`terraform.tfvars` の `alert_emails`(アラートの通知先)と `billing_account_id`(予算アラート。空なら作らない)も
ここで設定する(5章「監視・アラート」)。予算は請求先アカウントに作るため、作業者に請求先アカウントの
「請求先アカウント管理者」(または予算を作れる権限)が必要。ユーザーの ADC(`gcloud auth application-default login`)で
apply する場合、Billing Budgets API は割り当てプロジェクトの指定を要求するため、先に
`gcloud auth application-default set-quota-project "$PROJECT_ID"` を実行しておく(要確認)。

Cloud SQL の作成には10分前後かかる。`deploy_workloads = false` の間は Cloud Run・Scheduler は作らない
(Cloud Run はシークレットのバージョンとイメージが存在しないと作成に失敗するため)。

### 3.2 postgres ユーザーのパスワード

Cloud SQL の組み込み管理ユーザー `postgres`(`cloudsqlsuperuser` のメンバー。本当のスーパーユーザーではない)の
パスワードを設定する。Terraform の state に残さないため gcloud で行う。

```bash
gcloud sql users set-password postgres --instance=katahimo-db --prompt-for-password
```

### 3.3 ロール・データベースの作成(`infra/cloudsql/`)

Cloud Shell で Auth Proxy を起動し(別タブ)、psql で2つのスクリプトを流す。

```bash
# タブ1
cloud-sql-proxy "$(terraform -chdir=infra/gcp output -raw sql_connection_name)" --port 5432
# タブ2
export KATAHIMO_OWNER_PASSWORD="$(openssl rand -hex 24)"
export KATAHIMO_APP_PASSWORD="$(openssl rand -hex 24)"
psql "host=127.0.0.1 port=5432 user=postgres dbname=postgres" \
  -v owner_password="$KATAHIMO_OWNER_PASSWORD" -v app_password="$KATAHIMO_APP_PASSWORD" \
  -f infra/cloudsql/00_roles_and_database.sql
psql "host=127.0.0.1 port=5432 user=postgres dbname=katahimo" -f infra/cloudsql/01_bootstrap.sql
```

- `00`: ロール `katahimo`(テーブル所有者・マイグレーション用)と `katahimo_app`(アプリ用)を素の LOGIN ロールと
  して作り、`katahimo` が所有するデータベース `katahimo` を作る。`gcloud sql users create` / Terraform の
  `google_sql_user` で作ると自動で `cloudsqlsuperuser`(CREATEROLE / CREATEDB 付き)のメンバーになるため使わない。
  `postgres` を `katahimo` のメンバーにする(DB の所有者指定と既定権限の設定に必要)。再実行するとパスワードを
  設定し直す(ローテーションにも使う)。
- `01`: `btree_gist` 拡張(Cloud SQL の対応拡張。PostgreSQL 13 以降は trusted extension)、`katahimo_app` への
  CONNECT / USAGE、`katahimo` が今後作るテーブル・シーケンスへの既定権限(SELECT/INSERT/UPDATE/DELETE、
  USAGE/SELECT)。PUBLIC からは CONNECT を外す。ローカルの `infra/initdb/01_bootstrap.sql` と同じ権限構成。
- どちらのロールも `rolsuper = f`・`rolbypassrls = f` であることをスクリプト末尾の SELECT で確認する。
  テーブルは FORCE ROW LEVEL SECURITY のため、所有者 `katahimo` でもテナント分離は効く。
- **Cloud SQL 固有の注意(要確認)**: `cloudsqlsuperuser` は BYPASSRLS を持たない想定。運用者が全テナント横断で
  調べたいときは、スーパーユーザーではなく `SET app.tenant_id = '<id>'` をテナントごとに設定して読む。

このローカル検証: PostgreSQL 16 上で「CREATEROLE / CREATEDB だけを持つ非スーパーユーザー」(Cloud SQL の
`postgres` の代わり)で 00 → 01 → マイグレーション(所有者ロール)→ アプリロールでの seed・ログイン・顧客検索
(RLS 経由)まで通ることを確認済み。実際の Cloud SQL では未実施。

### 3.4 シークレットの登録

Terraform が作った入れ物(`katahimo-*`)に値を登録する。値は state に残らない。

```bash
add() { printf '%s' "$2" | gcloud secrets versions add "katahimo-$1" --data-file=-; }
CONN="$(terraform -chdir=infra/gcp output -raw sql_connection_name)"

add database-url           "postgres://katahimo_app:${KATAHIMO_APP_PASSWORD}@/katahimo?host=/cloudsql/${CONN}"
add migration-database-url "postgres://katahimo:${KATAHIMO_OWNER_PASSWORD}@/katahimo?host=/cloudsql/${CONN}"
add session-secret         "$(openssl rand -hex 32)"
add blind-index-key        "$(openssl rand -hex 32)"   # LOCAL_DEV_MASTER_KEY。後から変えられない(下記)
add smtp-pass              '<SMTP のパスワード>'
add google-maps-api-key    '<Maps API キー>'
add gemini-api-key         '<Gemini API キー>'
add legacy-auth-salt       '<GAS版 Script Properties の AUTH_SALT>'
# ミラー書き込み・gas_bridge を使う場合のみ
add gas-bridge-secret      '<GAS版 Script Properties の BRIDGE_API_SECRET>'
```

- パスワードに URL で特別な意味を持つ文字(`@ / : ? #` 等)を含める場合は % エンコードする
  (上の `openssl rand -hex` なら不要)。
- 任意のシークレット(smtp-pass / google-maps-api-key / gemini-api-key / legacy-auth-salt / gas-bridge-secret)
  は、値を登録したものだけを `terraform.tfvars` の `optional_secrets` に列挙する。
- `blind-index-key` を変えると既存の検索用インデックス(メール・氏名の blind index)が引けなくなる。
  `KMS_PROVIDER` も途中で変えない(既存の `tenant_keys` を復号できなくなる)。

### 3.5 Google 連携の準備

- **カレンダー**: 各スタッフのカレンダー(`staff.calendar_id`)と `google_calendar_ids` のカレンダーを、
  `terraform output service_accounts` の **api と worker** のメールアドレスに「予定の表示(すべての予定の詳細)」
  で共有する(夜間反映はワーカー、画面表示は API が読む)。ドメイン全体の委任(`GOOGLE_CALENDAR_IMPERSONATE`)は
  サービスアカウントキーが必要になるため使わない。
- **顧客CSVの Drive フォルダ**(`customer_csv_drive_folders`): 同じ2つのアドレスに「閲覧者」で共有する。
- **Maps API キー**: 「API とサービス > 認証情報」で作成し、API の制限を Geocoding API と Routes API に限定する
  (サーバーから呼ぶためアプリケーションの制限は「なし」か、Cloud Run の送信元IPが固定でないため IP 制限は不可)。
- **Gemini API キー**: Google AI Studio で発行(管理画面からテナントごとに設定したキーはDBに暗号化して保存され、
  こちらはその未設定時のフォールバック)。
- **SMTP**: パスワード再設定メールの送信に必須(Google Workspace の SMTP リレー等)。送信はワーカーが行う。

### 3.6 イメージのビルドと push(初回はデプロイしない)

Cloud Build の実行SA `katahimo-deployer` を作業者が使えるよう、作業者に `roles/iam.serviceAccountUser`
(対象: katahimo-deployer)と Cloud Build の実行権限(`roles/cloudbuild.builds.editor`)が必要。

```bash
gcloud builds submit --region="$REGION" --config=cloudbuild.yaml \
  --gcs-source-staging-dir="gs://${PROJECT_ID}-katahimo-build/source" \
  --service-account="projects/${PROJECT_ID}/serviceAccounts/katahimo-deployer@${PROJECT_ID}.iam.gserviceaccount.com" \
  --substitutions=_TAG="$(git rev-parse --short HEAD)",_DEPLOY=false
```

`api:<tag>` / `api:latest` / `worker:<tag>` / `worker:latest` が Artifact Registry に入る。

### 3.7 Cloud Run・ジョブ・Scheduler を作る

`terraform.tfvars` で `deploy_workloads = true` にして apply する(イメージは `image_tag`(既定 `latest`)を使う。
以後のイメージ更新は Cloud Build が行い、Terraform は image の差分を無視する)。

```bash
terraform -chdir=infra/gcp apply
```

Scheduler は `scheduler_paused = true`(既定)の間は一時停止状態で作られる(7章の切替日に false にする)。

### 3.8 マイグレーション

```bash
gcloud run jobs execute katahimo-migrate --region="$REGION" --wait
```

`MIGRATION_DATABASE_URL`(所有者 `katahimo`)で `packages/db/drizzle` を適用する。以後は Cloud Build が
デプロイの前に毎回実行する。

### 3.9 動作確認

```bash
URL="$(terraform -chdir=infra/gcp output -raw api_url)"
curl -s "$URL/api/health"      # {"status":"ok"}
curl -s "$URL/api/health/db"   # {"status":"ok"}(DB 接続まで確認。失敗時は {"status":"error"} で詳細はログ)
curl -sI "$URL/api/health" | grep -iE 'content-security-policy|strict-transport-security'   # セキュリティヘッダー
curl -sI "$URL/" | grep -i cache-control   # no-cache
```

ジョブを手動で1回流す(Scheduler は停止中のまま): `gcloud run jobs execute katahimo-csv-import --region="$REGION" --wait`。

### 3.10 初期データ

テナント・スタッフ・顧客の投入(`packages/api/src/scripts/`: `seed.ts` / `importStaffMasterCsv.ts` /
`importReservaCsv.ts`)は現状イメージに含めていない。当面は作業者の端末(または Cloud Shell)から
Auth Proxy 経由で本番 DB に向けて実行する:

```bash
cloud-sql-proxy "$CONN" --port 5433 &
gcloud auth application-default login   # KMS の鍵を使うため(作業者に cryptoKeyEncrypterDecrypter を一時付与)
DATABASE_URL="postgres://katahimo_app:${KATAHIMO_APP_PASSWORD}@127.0.0.1:5433/katahimo" \
KMS_PROVIDER=gcp GCP_KMS_KEY_NAME="$(terraform -chdir=infra/gcp output -raw kms_key_name)" \
LOCAL_DEV_MASTER_KEY="$(gcloud secrets versions access latest --secret=katahimo-blind-index-key)" \
SESSION_SECRET=unused-for-scripts-0000 \
  pnpm --filter @katahimo/api import:staff-master -- <テナントslug> <CSVパス>
```

(`NODE_ENV` は付けない。本番用の起動時検証は API サーバーのためのもの。)作業後は一時付与した KMS 権限を外す。
頻繁に行うようになったら、これらのスクリプトも worker イメージに含めて Cloud Run Job 化する(未対応)。

**本番テナントの作成手段は未整備**: テナントを作るのは現状 `seed.ts`(デモ用の固定 slug `demo` と管理者)だけ。
本番のテナント(例: `cutest`)と最初の管理者を作るスクリプトを用意してから取込を行う(8章)。

### 3.11 独自ドメイン・HTTPS

Cloud Run の既定URL(`https://katahimo-api-xxxx.a.run.app`)は最初から HTTPS。独自ドメインにする方法:

| 方法 | 特徴 |
| --- | --- |
| グローバル外部アプリケーションロードバランサ + サーバーレス NEG + Google マネージド証明書 | 推奨。Cloud Armor・CDN も付けられる。LB の固定費がかかる(月 $18 前後、要確認) |
| Cloud Run のドメインマッピング | 無料だがプレビュー扱いで、使えるリージョンに制限がある(asia-northeast1 で使えるか要確認) |
| Firebase Hosting の rewrite | **使わない**: Firebase Hosting は `__session` 以外の Cookie を Cloud Run へ渡さないため、セッション Cookie(`katahimo_session`)が届かずログインできない |

独自ドメインにしたら、`GOOGLE_OAUTH_REDIRECT_URI` 等 URL を含む設定を見直す(現状 Google ログインは未使用)。

## 4. 継続的デプロイ

- PR と main には GitHub Actions の CI(`.github/workflows/ci.yml`)が走る。main はブランチ保護で CI の成功と
  レビューを必須にし、それを通ったコミットだけが下の Cloud Build トリガーでデプロイされるようにする
  (設定内容は README「CI とブランチ保護」)。

- Cloud Build の GitHub トリガー(main への push)を作り、構成ファイルに `cloudbuild.yaml`、サービスアカウントに
  `katahimo-deployer` を指定する(GitHub 連携はコンソールで設定する)。`_TAG` はトリガー実行ではコミットの短い
  SHA になる。
- 流れ: api / worker を並列にビルド → push → `katahimo-migrate` のイメージを差し替えて実行(失敗したら中断)
  → `katahimo-api` / `katahimo-worker` / 各ジョブのイメージを差し替え。`gcloud run services update` を使うため、
  Terraform が作っていないサービスを誤って新規作成することはない。
- **マイグレーションは新しいアプリのデプロイ前に流れる**ため、旧バージョンのアプリでも動く形で書く(列の追加 →
  アプリ更新 → 旧列の削除は次のリリース、の2段階)。

## 5. 運用

### ロールバック

- アプリ: 直前のリビジョンへトラフィックを戻す。
  `gcloud run services update-traffic katahimo-api --region="$REGION" --to-revisions=<リビジョン名>=100`
  (リビジョン一覧は `gcloud run revisions list --service=katahimo-api`)。worker も同様。ジョブは
  `gcloud run jobs update <ジョブ> --image=<前のタグ>`。Artifact Registry は直近20件のイメージを残す。
- DB: マイグレーションは自動では戻らない。壊れた場合はポイントインタイムリカバリ(PITR、7日分)で
  別インスタンスに復元して切り替える(`gcloud sql instances clone katahimo-db katahimo-db-restore
  --point-in-time=<UTC時刻>`)。自動バックアップは毎日 JST 01:00、14世代。

### ログ

アプリは1行JSON(`severity` / `message` …)を標準出力・標準エラーに出し、Cloud Logging が構造化ログとして
取り込む。操作ログ・監査ログは DB の `app_logs` にも残る(テナントごとに RLS)。

```
# API のエラー
resource.type="cloud_run_revision" AND resource.labels.service_name="katahimo-api" AND severity>=ERROR
# 夜間ジョブ
resource.type="cloud_run_job" AND resource.labels.job_name="katahimo-nightly-calendar-sync"
# outbox の送信失敗(自動再試行を打ち切ったものは app_logs に mirror.job_failed の ERROR も残る)
resource.labels.service_name="katahimo-worker" AND jsonPayload.failed>0
```

### 監視・アラート(`infra/gcp/monitoring.tf`)

通知先は `alert_emails`(メールの通知チャネル)。空でもアラートは作られ、Monitoring のインシデント一覧で見える。
各アラートの本文(documentation)に、最初に見るべきログと対処を書いてある。

| アラート | 条件(既定) | 重大度 |
| --- | --- | --- |
| `katahimo-api: 5xx 応答の増加` | `run.googleapis.com/request_count` の 5xx が 5 分間に `alert_api_5xx_threshold`(5)件を超えた。利用者が少なく割合だと1件で跳ねるため件数で見る | ERROR |
| `katahimo ジョブ: 実行の失敗` | `run.googleapis.com/job/completed_execution_count` の `result=failed`(再試行を使い切った失敗)。対象は migrate / nightly-calendar-sync / csv-import / sync-busy-blocks | ERROR |
| `katahimo-db: 資源の逼迫` | CPU 80% が 15 分・ディスク 80%・接続数(`num_backends` の合計)が `alert_sql_connections_threshold`(40)超 | WARNING |
| `katahimo-api: 外形監視の失敗` | `https://<API のホスト>/api/health` を 3 地域から 5 分ごとに確認し、2 地域以上で 10 分間失敗。ホストは Cloud Run の URL(独自ドメインにしたら `uptime_check_host`)。`deploy_workloads = true` のときに作る | CRITICAL |
| 予算(`google_billing_budget`) | 月額 `budget_amount`(既定 30,000 円)の 50% / 90% / 100%(実績)と 100%(月末の予測)。請求先アカウントの管理者と `alert_emails` に届く。`billing_account_id` を指定したときだけ作る | — |

未対応: 夜間ジョブが**そもそも起動しなかった**こと(Scheduler の一時停止・失敗)は上のアラートでは検知できない。
切替後は翌朝の確認(7章)で見るか、Scheduler の失敗ログ(`resource.type="cloud_scheduler_job" AND severity>=ERROR`)の
ログベースアラートを足す(8章)。

### Terraform のロックファイル

`infra/gcp/.terraform.lock.hcl` にプロバイダー(`hashicorp/google`)の版とハッシュ(linux / darwin の amd64・arm64、
windows_amd64 の `h1:` と、全プラットフォームの `zh:`)を固定している。`terraform init` はこの版を使い、CI
(`infra.yml`)は `-lockfile=readonly` で違う版を入れようとしたら失敗する。版を上げるとき(Dependabot の PR か手で):

```bash
cd infra/gcp
terraform init -backend=false -upgrade
terraform providers lock -platform=linux_amd64 -platform=linux_arm64 \
  -platform=darwin_amd64 -platform=darwin_arm64 -platform=windows_amd64
git add .terraform.lock.hcl
```

`registry.terraform.io` に届かない環境では、`releases.hashicorp.com` から各プラットフォームのプロバイダーの zip と
署名付きの `SHA256SUMS` を取って `terraform providers lock -fs-mirror=<dir> -platform=…` で作れる(初版はこの方法で作り、
`zh:` は署名を確かめた `SHA256SUMS` の値を入れた)。

### Docker のベースイメージ

`Dockerfile` の `FROM node:22-bookworm-slim@sha256:…` はダイジェストで固定している。Node のパッチ・OS の
セキュリティ更新は Dependabot(docker)が週1回ダイジェストを差し替える PR を出すので、CI が通ればマージして
デプロイする。手で更新するときは `docker buildx imagetools inspect node:22-bookworm-slim` の `Digest` に書き換える。

### シークレット・パスワードのローテーション

- Cloud Run はインスタンス起動時に `latest` を読む。値を更新したら新しいリビジョンを作って反映する
  (`gcloud run services update katahimo-api --region="$REGION" --update-labels=secret-rotated=$(date +%s)` 等)。
- DB パスワード: `00_roles_and_database.sql` を新しいパスワードで再実行 → `database-url` /
  `migration-database-url` に新しいバージョンを追加 → サービス・ジョブを再デプロイ。
- KMS の `tenant-kek` は90日ごとに自動ローテーションされる(旧バージョンは有効なまま残り、既存の DEK も復号
  できる)。旧バージョンを無効化・破棄するには、先に全テナントの DEK を新バージョンで再ラップする作業が必要
  (未実装)。

### スケール

- API: `api_max_instances` と `api_db_pool_max`(1章「接続数の見積もり」)。
- Cloud SQL: `sql_tier` を変えて apply(数分の再起動を伴う)。`sql_high_availability = true` で HA。

## 6. コストの目安(東京リージョン、月額、要確認)

| 項目 | 前提 | 目安 |
| --- | --- | --- |
| Cloud SQL | db-g1-small・ゾーン構成・SSD 10GB・バックアップ | $30〜40(HA は約2倍) |
| Cloud Run: worker | 1 vCPU / 512MiB を常時割り当て・1インスタンス | $45〜55(**最大の固定費**。下記) |
| Cloud Run: api | 最小0インスタンス・リクエスト課金 | 無料枠内〜数ドル |
| Cloud Run Jobs | 1日2回・数分 | 無料枠内 |
| Cloud Scheduler | 2ジョブ(請求先アカウントあたり3ジョブ無料) | $0 |
| Secret Manager / KMS | 9シークレット・鍵1つ | $1 未満 |
| Artifact Registry | イメージ 約0.3GB × 保持数 | $1〜2 |
| Cloud Build | 1日数回 | 無料枠内 |
| Cloud Logging | 50GiB/月まで無料 | $0 |
| Cloud Monitoring | アラートの条件6つ・外形監視1つ(`monitoring.tf`) | 無料枠内〜$1 程度(アラート条件の課金の有無は要確認) |
| Maps(Geocoding / Routes)・Gemini | 利用量次第 | 無料枠を超えた分 |

**worker の固定費を下げる選択肢**(8章の未決事項): パスワード再設定メールも outbox 経由で送るため、
`outbox_poller_enabled = false` で止める場合は下の「毎分 `outbox-once`」等の代わりが必要 / `worker_cpu` を下げる(1 vCPU 未満にできるかは CPU 常時割り当ての制約次第、要確認)/ 常駐をやめ、
Cloud Scheduler で毎分 `dist/outbox-once.js` のジョブを起動する(反映が最大1分ほど遅れるが、使った分だけの課金)/
Cloud Run の worker pools(常駐のプル型ワーカー向け、提供状況要確認)。

## 7. GAS版からの切替チェックリスト

GAS 側の変更は `katahimo-dev/gas-childcare-visit-app` リポジトリで行う(このリポジトリの `legacy/` は読み取り専用)。

### 切替前

- [ ] 本番環境で3章を終え、`/api/health/db`・ログイン・予定表示・出勤簿を確認した
- [ ] スタッフマスタ・顧客CSVを取り込んだ(3.10)。`legacy-auth-salt` を登録し、既存スタッフが今のパスワードで
      ログインできることを確認した
- [ ] カレンダーと顧客CSVフォルダを api / worker のサービスアカウントに共有した(3.5)
- [ ] ミラーを続けるか決めた。続ける場合は `gas_bridge_url` / `gas-bridge-secret` / `mirror_to_google_sheets = true`
      を設定し、GAS 側 Bridge.js の書き込み action をデプロイした(`doc/api/attendance-batch.md`
      「GAS側(Bridge.js)に必要な変更」)。**GAS の Web App(Bridge)は、ミラーか `SCHEDULE_PROVIDER=gas_bridge`
      を使う間は公開したままにする**
- [ ] `katahimo-nightly-calendar-sync` / `katahimo-csv-import` を手動実行して結果を確認した(Scheduler は停止中)

### 切替日(同じ日に行う。二重反映・二重取込を防ぐため)

- [ ] **gas-childcare-visit-app**(`Triggers.js` の `VISIT_APP_TRIGGER_DEFS`): `autoSyncTodayScheduleForAllStaff`
      (毎日22時台)と `checkAndImportLatestCsv`(毎日3時台)を `enabled: false` にして `clasp push` →
      `setupAllTriggers()` を実行 → `listProjectTriggers()` で2件が消えたことを確認
- [ ] 新版の Scheduler を有効化: `terraform.tfvars` の `scheduler_paused = false` で apply
      (`gcloud scheduler jobs list --location="$REGION"` で ENABLED を確認)
- [ ] スタッフに新しいURLを案内する(PWA としてホーム画面に追加)

### 切替後

- [ ] 翌朝、夜間ジョブ2件が成功していること(Cloud Logging / `gcloud run jobs executions list`)と、
      出勤簿・顧客データが更新されていることを確認
- [ ] **gas-childcare-visit-app の `flushLogsToDrive`**(10分おき): GAS 版の画面を誰も使わなくなり、Bridge も
      使わなくなった時点で `enabled: false` にして `setupAllTriggers()`(最後にバッファを書き出すため、止める直前に
      一度手動実行する)。GAS の Web App の公開停止も同じタイミング
- [ ] **gas-root-serach**: `autoRunSaveAttendance()`(今日のルート → 勤怠集計)は visit-app で代替済みのため、
      まだ残っていれば `Decommission.js` の `deleteDecommissionTriggers()` で削除。`main()`(翌日分のルート集計・
      LINE WORKS 通知)は新版で代替していないため、業務上不要と確認できた場合のみ削除する
- [ ] **gas-childcare-daily-report**: `autoRunDailyTransfer()`(勤怠集計 → 個別出勤簿の夜間転記)を
      `Decommission.js` の `deleteDecommissionTriggers()` で削除
- [ ] **gas-integrated-system**: Web App の公開を停止(廃止確認済み)
- [ ] トリガーの削除は各プロジェクトの「作成したアカウント」で行う必要がある(`ScriptApp.getProjectTriggers()`
      は実行ユーザーが作ったトリガーしか返さない。`legacy/gas-childcare-visit-app/gas-account-migration/README.md`)

## 8. 未決事項・今後の対応

- 夜間ジョブが起動しなかったことの検知(Scheduler の失敗のログベースアラート、または実行の有無の監視。5章「監視・アラート」)。
- worker の常駐方式(6章の選択肢)。パスワード再設定メールを outbox 経由で送るため、ミラーを使わない間も
  outbox の処理は要る(常駐をやめる場合は Cloud Scheduler から `outbox-once` を数分おきに動かす等の代わりが必要)。
- **ネットワークの防御(セキュリティレビュー 2026-09、未対応)**:
  - Cloud Armor: API の前に外部HTTPSロードバランサ+サーバーレスNEGを置き、Cloud Armor のセキュリティポリシー
    (IP単位のレート制限・国/地域の制限・OWASP のプリセットルール)を付けるか。アプリ側でもログイン・パスワード
    再設定・AI・地図の回数制限(`rate_limit_buckets`)は行っているが、大量の要求そのものは Cloud Run に届く。
    ロードバランサを置く場合は、ingress を `INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER` にして run.app の URL を
    閉じ、`TRUSTED_PROXY_HOPS=2`(X-Forwarded-For の末尾にLBのIPが加わるため。`doc/api/auth-reports-settings.md`
    「送信元IPの判定」)にする。
  - Cloud SQL のプライベートIP: 現在は Cloud Run の「Cloud SQL 接続」(Auth Proxy 相当、パブリックIP+IAM許可)。
    パブリックIPを無効にしてプライベートIP(Private Service Connect / VPC ピアリング)+ Direct VPC egress で
    接続するか(`authorized_networks` を空にしているため外部から直接は繋がらないが、パブリックIPを持たない方が
    攻撃面は小さい)。
- 本番テナントと最初の管理者を作るスクリプト、および管理用スクリプト(スタッフマスタ・顧客CSV の取込)の
  Cloud Run Job 化(3.10)。
- 独自ドメインの方式(3.11)。
- `tenant-kek` の旧バージョンを破棄するための DEK 再ラップ処理(5章)。
- 領収書バケットを CMEK(`tenant-kek` とは別の鍵)で暗号化するか(既定は Google 管理の鍵)。
- `GcsStoragePort.signedUrl`(V4 署名付きURL)は現状どこからも使っていない。使う場合は api の実行SA自身に
  `roles/iam.serviceAccountTokenCreator`(signBlob)を付ける(署名の形式は単体テストで確認済みだが、
  実際の GCS での検証は未実施)。
