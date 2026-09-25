# 使う API の有効化。destroy しても API は無効化しない(他の用途で使っている可能性があるため)。
locals {
  services = [
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com", # GCS 署名付きURL(signBlob)
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com", # Cloud Run の Cloud SQL 接続(Auth Proxy)が使う
    "storage.googleapis.com",
    # アプリが直接呼ぶ Google API(実行サービスアカウントの ADC で認証する)
    "calendar-json.googleapis.com",
    "drive.googleapis.com",
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
