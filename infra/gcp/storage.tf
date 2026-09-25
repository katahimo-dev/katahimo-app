# ── コンテナイメージ ─────────────────────────────────────────
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "katahimo"
  format        = "DOCKER"
  description   = "katahimo-app のイメージ(api / worker)"

  # ロールバック用に直近のイメージは残し、古いものは消す
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "7776000s" # 90日
    }
  }

  depends_on = [google_project_service.enabled]
}

# ── 領収書画像(STORAGE_PROVIDER=gcs) ─────────────────────────
resource "google_storage_bucket" "receipts" {
  name     = "${var.project_id}-katahimo-receipts"
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # 誤削除からの復旧用(削除・上書きされたオブジェクトを30日保持)
  versioning {
    enabled = true
  }
  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# API は保存・取得・削除、ワーカーは GAS 版 Drive へのミラー用に取得だけ
resource "google_storage_bucket_iam_member" "receipts_api" {
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.api.email}"
}

resource "google_storage_bucket_iam_member" "receipts_worker" {
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.worker.email}"
}

# ── gcloud builds submit のソース置き場 ─────────────────────────
resource "google_storage_bucket" "build_staging" {
  name                        = "${var.project_id}-katahimo-build"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
}

# ── テナントDEKをラップする KEK(KMS_PROVIDER=gcp) ──────────────
# キーリング・鍵は削除できない(鍵バージョンの破棄のみ)ため prevent_destroy にする。
resource "google_kms_key_ring" "katahimo" {
  name     = "katahimo"
  location = var.region

  depends_on = [google_project_service.enabled]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "tenant_kek" {
  name     = "tenant-kek"
  key_ring = google_kms_key_ring.katahimo.id
  purpose  = "ENCRYPT_DECRYPT"
  # 自動ローテーション。旧バージョンは有効なまま残るため既存DEKも復号できる(CloudKmsPort 参照)
  rotation_period = "7776000s" # 90日

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "tenant_kek" {
  for_each = {
    api    = google_service_account.api.email
    worker = google_service_account.worker.email
  }
  crypto_key_id = google_kms_crypto_key.tenant_kek.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${each.value}"
}
