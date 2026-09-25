# 更新履歴 (katahimo-app)

## [Ver. 0.0.3] - 2026-09-25

- GCP 本番環境へのデプロイ一式を追加(`doc/11_GCPデプロイ手順.md`): `Dockerfile`(api / worker の2ターゲット、
  非rootユーザー)、`cloudbuild.yaml`(ビルド → マイグレーション → デプロイ)、Terraform(`infra/gcp/`: Cloud Run
  サービス・ジョブ、Cloud Scheduler(JST 22:00 / 03:00)、Cloud SQL、Secret Manager、Artifact Registry、GCS、
  Cloud KMS、サービスアカウント)、Cloud SQL 用のロール初期化SQL(`infra/cloudsql/`)。
- API が本番でビルド済みのWeb画面を同じオリジンから配信するようにした(`WEB_DIST_DIR`、SPA フォールバック、
  ハッシュ付きアセットは長期キャッシュ・`index.html` と Service Worker は `no-cache`)。
- Cloud SQL の Unix ソケット形式の `DATABASE_URL`(`?host=/cloudsql/...`)に対応し、接続プールを
  `DB_POOL_MAX` / `DB_IDLE_TIMEOUT_SEC` / `DB_MAX_LIFETIME_SEC` で調整できるようにした。
- 領収書画像の保存先に GCS(`STORAGE_PROVIDER=gcs`、`GcsStoragePort`)、テナントDEKの KEK に Cloud KMS
  (`KMS_PROVIDER=gcp`、`CloudKmsPort`)を追加。本番(`NODE_ENV=production`)ではどちらも必須とし、
  `SCHEDULE_PROVIDER` の明示・32文字以上の `SESSION_SECRET` とあわせて起動時に検証する。
- api / worker / db に tsup の本番ビルドを追加(ワークスペース内パッケージを取り込み、外部依存は node_modules から
  読む)。常駐ワーカーは `WORKER_HEALTH_PORT` でヘルスチェックに応答する(Cloud Run サービス用)。

## [Ver. 0.0.2] - 2026-09-25

- 出勤簿(過去の予定タブ)をGAS版と同じ挙動に揃えた: 当月のみ編集できる月ロック、変わった列だけの保存(`changed_fields`・変更履歴・強調表示つきミラー)、カレンダーからの反映(プレビュー/反映/冪等)、月次まとめ(全日・働いた時間・領収書集計)、勤怠集計の書き直し。
- outboxミラーの再試行(指数バックオフ・上限回数・異常終了したジョブの取り直し)と、勤怠集計(`attendance_aggregate`)のミラーを追加。
- ワーカーを常駐のoutboxポーラーと単発ジョブ(`job:nightly-calendar-sync` 22:00 / `job:csv-import` 03:00 JST)に分けた。顧客CSVの自動取込(Google Drive / ローカルディレクトリ)と `GET /api/data-version`、管理者の手動取込 `POST /api/admin/customers/import` を追加。仕様は `doc/api/attendance-batch.md`。

## [Ver. 0.0.1] - 2026-09-25

- 新規リポジトリとして作り直しを開始。GAS版を `legacy/gas-childcare-visit-app` に git submodule で取り込み、旧試作の設計資料を `doc/reference/` に置いた。
