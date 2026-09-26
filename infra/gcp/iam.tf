# 実行用サービスアカウント(用途ごとに分け、必要な権限だけを付ける)。
#
# Google Calendar / Drive は IAM ロールではなく「共有」で読み取りを許可する:
#   - 各スタッフのカレンダー(とテナントの共有カレンダー。pnpm tenant:calendars)を katahimo-api / katahimo-worker の
#     メールアドレスに「予定の表示(すべての予定の詳細)」で共有する
#   - 顧客CSVの Drive フォルダ(テナントごと。pnpm tenant:customer-source)を同じ2つに「閲覧者」で共有する
# (ドメイン全体の委任 GOOGLE_CALENDAR_IMPERSONATE は SA キーが必要になるため使わない。doc/07_インフラ・運用.md 3.4)

resource "google_service_account" "api" {
  account_id   = "katahimo-api"
  display_name = "katahimo API(Cloud Run サービス)"
}

resource "google_service_account" "worker" {
  account_id   = "katahimo-worker"
  display_name = "katahimo ワーカー(outbox ポーラー・夜間ジョブ)"
}

resource "google_service_account" "migrate" {
  account_id   = "katahimo-migrate"
  display_name = "katahimo マイグレーション(Cloud Run Job)"
}

resource "google_service_account" "scheduler" {
  account_id   = "katahimo-scheduler"
  display_name = "katahimo Cloud Scheduler(ジョブの起動だけ)"
}

resource "google_service_account" "deployer" {
  account_id   = "katahimo-deployer"
  display_name = "katahimo Cloud Build(イメージのビルド・デプロイ)"
}

# Cloud SQL への接続(Cloud Run の Cloud SQL 接続が使う)。DB 内の権限は DB ロール側で分けている。
resource "google_project_iam_member" "cloudsql_client" {
  for_each = {
    api     = google_service_account.api.email
    worker  = google_service_account.worker.email
    migrate = google_service_account.migrate.email
  }
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value}"
}

# ── デプロイ用(cloudbuild.yaml の serviceAccount) ─────────────────
resource "google_project_iam_member" "deployer" {
  for_each = toset([
    "roles/run.developer",     # サービスのデプロイ・ジョブの更新と実行
    "roles/logging.logWriter", # ビルドログ(options.logging: CLOUD_LOGGING_ONLY)
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# デプロイ時に実行SAを Cloud Run に割り当てるための権限(actAs)。対象のSAに限定する。
resource "google_service_account_iam_member" "deployer_act_as" {
  for_each = {
    api     = google_service_account.api.name
    worker  = google_service_account.worker.name
    migrate = google_service_account.migrate.name
  }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# gcloud builds submit のソース置き場(--gcs-source-staging-dir)。GitHub トリガーでは使わない。
resource "google_storage_bucket_iam_member" "deployer_read_source" {
  bucket = google_storage_bucket.build_staging.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.deployer.email}"
}
