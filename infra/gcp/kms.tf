# Cloud KMS(asia-northeast1)。使うのはテナントの秘密値の封の鍵 tenant-secrets だけで、デモ専用の環境(demo_mode)では作らない。
# - tenant-secrets: テナントの秘密値(Gemini API キー・Google Chat の Webhook URL)の封(API の SecretBox が
#   Cloud KMS の encrypt / decrypt を直接呼ぶ)。90日ごとに自動でローテーションする(新しい鍵バージョンが主バージョンになり、
#   古いバージョンは復号のために残る)。
# - Cloud SQL・領収書バケットのディスク暗号化は Google 管理の鍵(既定)で、CMEK(アプリ専用の鍵)は使わない。
#   デモ専用の環境の秘密値は Secret Manager の secret-box-local-key(SECRET_BOX_PROVIDER=local。secrets.tf)で封する。
# 鍵(の全バージョン)を無効化・破棄すると、その鍵で封した値は二度と読めない(管理者設定で保存し直す)。
# キーリング・鍵は GCP 上で削除できない(鍵バージョンの破棄のみ)ため、prevent_destroy にする(doc/07_インフラ・運用.md 3.8)。

resource "google_kms_key_ring" "katahimo" {
  count    = var.demo_mode ? 0 : 1
  name     = "katahimo"
  location = var.region

  depends_on = [google_project_service.enabled]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "tenant_secrets" {
  count           = var.demo_mode ? 0 : 1
  name            = "tenant-secrets"
  key_ring        = google_kms_key_ring.katahimo[0].id
  purpose         = "ENCRYPT_DECRYPT"
  rotation_period = "7776000s" # 90日

  lifecycle {
    prevent_destroy = true
  }
}

# 秘密値の封と開封は API と運用スクリプト(ops。テナントの Gemini のキーを使う ai:compare 等)だけ
# (ワーカーは tenant_secrets を読まない)
resource "google_kms_crypto_key_iam_member" "tenant_secrets_api" {
  count         = var.demo_mode ? 0 : 1
  crypto_key_id = google_kms_crypto_key.tenant_secrets[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.api.email}"
}

resource "google_kms_crypto_key_iam_member" "tenant_secrets_ops" {
  count         = var.demo_mode ? 0 : 1
  crypto_key_id = google_kms_crypto_key.tenant_secrets[0].id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${google_service_account.ops.email}"
}
