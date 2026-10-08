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
    enabled = !var.demo_mode
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

# 運用スクリプト(ops)は GAS版からの領収書の取込(import:legacy-receipts)で画像を書く
resource "google_storage_bucket_iam_member" "receipts_ops" {
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.ops.email}"
}

resource "google_storage_bucket_iam_member" "receipts_worker" {
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_storage_bucket_iam_member" "receipts_demo_reset" {
  count  = var.demo_mode ? 1 : 0
  bucket = google_storage_bucket.receipts.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.demo_reset[0].email}"
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

# ── 運用スクリプト(ops ジョブ)の入出力の受け渡し ─────────────────
# 顧客・スタッフの CSV(個人情報)や ai:compare の HTML を置くため、7日で消す(保存時の暗号化は Google 管理の鍵)。
# ops ジョブが /ops に載せる(run.tf)。運用担当者は gsutil / gcloud storage で置く・取る(doc/07_インフラ・運用.md 3.6)。
resource "google_storage_bucket" "ops" {
  name                        = "${var.project_id}-katahimo-ops"
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

resource "google_storage_bucket_iam_member" "ops_job" {
  bucket = google_storage_bucket.ops.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.ops.email}"
}
