# 実行用サービスアカウント(用途ごとに分け、必要な権限だけを付ける)。
#
# Google Calendar / Drive は IAM ロールではなく「共有」で読み取りを許可する:
#   - 各スタッフのカレンダー(とテナントの共有カレンダー。pnpm tenant:calendars)を katahimo-api / katahimo-worker の
#     メールアドレスに「予定の表示(すべての予定の詳細)」で共有する
#   - 顧客CSVの Drive フォルダ(テナントごと。pnpm tenant:customer-source)を同じ2つに「閲覧者」で共有する
#   - GAS版からの移行の取込(pnpm import:legacy-reports / import:legacy-receipts)をサービスアカウントで流す場合は、GAS版の
#     スプレッドシート2つと領収書の画像のフォルダを katahimo-api に「閲覧者」で共有する(領収書の画像を書く GCS の権限を
#     持つのは api だけ。運用担当者が一時的に成り代わる。doc/09_移行計画.md 2.4)
# (ドメイン全体の委任 GOOGLE_CALENDAR_IMPERSONATE は SA キーが必要になるため使わない。doc/07_インフラ・運用.md 3.4)

resource "google_service_account" "api" {
  account_id   = "katahimo-api"
  display_name = "katahimo API(Cloud Run サービス)"
}

resource "google_service_account" "worker" {
  account_id   = "katahimo-worker"
  display_name = "katahimo ワーカー(outbox-drain・夜間ジョブ)"
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
    # cloudbuild.yaml の verify-source が、動いているビルドの承認の状態(gcloud builds describe の approval.state)を読む
    # (cloudbuild.builds.get。上の2つには含まれない)。読むだけで、ビルドの作成・承認・トリガーの編集はできない。
    # doc/07_インフラ・運用.md 4.1
    "roles/cloudbuild.builds.viewer",
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

# ── リリース(Cloud Build のトリガー katahimo-release。doc/07_インフラ・運用.md 4.1) ──────────
# cloudbuild.yaml の最初のステップ verify-source が GitHub のタグと main を読むためのトークン(第 2 世代の接続の
# accessReadToken)を出す権限。接続はコンソールで作るため(doc/07 4.1)、作った後に cloudbuild_github_connection を設定する。
# 読めるのはこの接続にリンクしたリポジトリだけ(GitHub App は katahimo-app だけに入れる)。
resource "google_cloudbuildv2_connection_iam_member" "deployer_read_token" {
  count    = var.cloudbuild_github_connection == "" ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = var.cloudbuild_github_connection
  role     = "roles/cloudbuild.readTokenAccessor"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# トリガーの承認(承認必須。doc/07 4.1)ができる人。名前を挙げた運用担当者だけにする(グループ・SA を足さない)。
# プロジェクトのオーナー(基本ロール)もこの権限を含むため、オーナーも同じく絞っておく。
resource "google_project_iam_member" "release_approvers" {
  for_each = toset(var.release_approvers)
  project  = var.project_id
  role     = "roles/cloudbuild.builds.approver"
  member   = each.value
}

# ── データアクセス監査ログ ─────────────────────────────────────
# 管理アクティビティログ(鍵・シークレット・権限の変更)は何もしなくても残る。ここでは「中身を読んだ・書いた」も残す
# (漏えいの疑いがあるときの追跡用。DB の中身は Cloud SQL のデータアクセスログには出ないため、アプリの操作ログ app_logs で追う)。
#   secretmanager … シークレットの値の読み取り(AccessSecretVersion)・登録
#   cloudkms      … 鍵の使用(encrypt / decrypt。テナントのシークレットの封、CMEK のサービスエージェントの利用)
#   storage       … 領収書バケット・ビルド用バケットのオブジェクトの読み書き
# Cloud SQL(ADMIN_READ 等)・Cloud Run の読み取りは量のわりに得るものが少ないため入れない。
resource "google_project_iam_audit_config" "data_access" {
  for_each = var.data_access_audit_logs ? toset([
    "secretmanager.googleapis.com",
    "cloudkms.googleapis.com",
    "storage.googleapis.com",
  ]) : toset([])

  project = var.project_id
  service = each.value

  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
