# 使う API の有効化。destroy しても API は無効化しない(他の用途で使っている可能性があるため)。
locals {
  services = [
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com", # 予算アラート(monitoring.tf。billing_account_id を指定したときに使う)
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudscheduler.googleapis.com",
    "compute.googleapis.com", # VPC・サブネット(network.tf。Cloud Run の Direct VPC egress)
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # GCS 署名付きURL(signBlob)
    "logging.googleapis.com",        # ログに基づく指標(monitoring.tf)
    "monitoring.googleapis.com",     # アラート・外形監視(monitoring.tf)
    "run.googleapis.com",            # API が outbox-drain の起動を頼む(jobs.run)のもこの API
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com", # Cloud SQL のプライベート IP(プライベート サービス アクセス。network.tf)
    "sqladmin.googleapis.com",          # Cloud SQL の言語コネクタ・cloud-sql-proxy が接続先と証明書を取る
    "storage.googleapis.com",
    # アプリが直接呼ぶ Google API(実行サービスアカウントの ADC で認証する)
    "calendar-json.googleapis.com",
    "drive.googleapis.com",
    "sheets.googleapis.com", # GAS版のスプレッドシートからの移行の取込(pnpm import:legacy-reports / import:legacy-receipts)
    # Google Maps Platform(API キーで呼ぶ。キーは Secret Manager の google-maps-api-key)
    "geocoding-backend.googleapis.com",
    "routes.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}
