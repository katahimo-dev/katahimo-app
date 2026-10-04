# Cloud KMS(asia-northeast1)。鍵は用途ごとに分ける:
# - cloudsql-cmek / storage-cmek: 保存データのディスク暗号化の鍵(CMEK)。Cloud SQL(ディスク・バックアップ)と
#   領収書画像の GCS バケットを、このアプリ専用の鍵で暗号化する。暗号化・復号は各サービスが行い、アプリは鍵を扱わない。
# - tenant-secrets: テナントの秘密値(Gemini API キー・Google Chat の Webhook URL)の封(API の SecretBox が
#   Cloud KMS の encrypt / decrypt を直接呼ぶ)。
# どの鍵も90日ごとに自動でローテーションする(新しい鍵バージョンが主バージョンになり、古いバージョンは復号のために残る)。
# GCS は以後に書くオブジェクトを新しいバージョンで暗号化する。Cloud SQL は既存のインスタンスを自動では暗号化し直さない
# (揃えるなら gcloud sql instances reencrypt。doc/07_インフラ・運用.md 3.8)。
# 鍵(の全バージョン)を無効化・破棄すると、その鍵で暗号化したデータはバックアップも含めて二度と読めない。
# キーリング・鍵は GCP 上で削除できない(鍵バージョンの破棄のみ)ため、全て prevent_destroy にする
# (doc/07_インフラ・運用.md 3.8)。

resource "google_kms_key_ring" "katahimo" {
  name     = "katahimo"
  location = var.region

  depends_on = [google_project_service.enabled]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "cloudsql" {
  name            = "cloudsql-cmek"
  key_ring        = google_kms_key_ring.katahimo.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90日

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "storage" {
  name            = "storage-cmek"
  key_ring        = google_kms_key_ring.katahimo.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90日

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "tenant_secrets" {
  name            = "tenant-secrets"
  key_ring        = google_kms_key_ring.katahimo.id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90日

  lifecycle {
    prevent_destroy = true
  }
}

# ── CMEK を使うサービスエージェント ─────────────────────────────
# Cloud SQL のサービスエージェント(service-<プロジェクト番号>@gcp-sa-cloud-sql.iam.gserviceaccount.com)は
# 初めて使うまで作られないため、ここで作る(google-beta のみのリソース)。
resource "google_project_service_identity" "sqladmin" {
  provider = google-beta
  service  = "sqladmin.googleapis.com"

  depends_on = [google_project_service.enabled]
}

# GCS のサービスエージェント(service-<プロジェクト番号>@gs-project-accounts.iam.gserviceaccount.com)
data "google_storage_project_service_account" "gcs" {
  depends_on = [google_project_service.enabled]
}

resource "google_kms_crypto_key_iam_member" "cloudsql_cmek" {
  crypto_key_id = google_kms_crypto_key.cloudsql.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = google_project_service_identity.sqladmin.member
}

resource "google_kms_crypto_key_iam_member" "storage_cmek" {
  crypto_key_id = google_kms_crypto_key.storage.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = data.google_storage_project_service_account.gcs.member
}

# IAM の付与は反映まで数十秒かかることがあり、直後に CMEK のインスタンス・バケットを作ると鍵の権限エラーになる。
# 付与のあと少し待ってから作る(sql.tf・storage.tf の depends_on)。
resource "time_sleep" "cmek_iam_propagation" {
  create_duration = "60s"

  depends_on = [
    google_kms_crypto_key_iam_member.cloudsql_cmek,
    google_kms_crypto_key_iam_member.storage_cmek,
  ]
}

# 秘密値の封と開封は API と運用スクリプト(ops。テナントの Gemini のキーを使う ai:compare 等)だけ
# (ワーカーは tenant_secrets を読まない)
resource "google_kms_crypto_key_iam_member" "tenant_secrets_api" {
  crypto_key_id = google_kms_crypto_key.tenant_secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.api.email}"
}

resource "google_kms_crypto_key_iam_member" "tenant_secrets_ops" {
  crypto_key_id = google_kms_crypto_key.tenant_secrets.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.ops.email}"
}
