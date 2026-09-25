# Cloud Run(サービス: api / worker、ジョブ: migrate / 夜間バッチ)。
# イメージの更新は cloudbuild.yaml(gcloud run deploy / jobs update)が行うため、Terraform は image の
# 差分を無視する。env やリソース量の変更は Terraform で行う。

locals {
  registry      = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  api_image     = "${local.registry}/api:${var.image_tag}"
  worker_image  = "${local.registry}/worker:${var.image_tag}"
  sql_conn_name = google_sql_database_instance.main.connection_name

  # API・ワーカー・夜間ジョブ共通(packages/api/src/env.ts / packages/worker/src/env.ts)。空の値は渡さない。
  common_env = { for k, v in {
    NODE_ENV                   = "production"
    KMS_PROVIDER               = "gcp"
    GCP_KMS_KEY_NAME           = google_kms_crypto_key.tenant_kek.id
    STORAGE_PROVIDER           = "gcs"
    GCS_BUCKET                 = google_storage_bucket.receipts.name
    SCHEDULE_PROVIDER          = var.schedule_provider
    GOOGLE_CALENDAR_IDS        = var.google_calendar_ids
    GAS_BRIDGE_URL             = var.gas_bridge_url
    CUSTOMER_CSV_DRIVE_FOLDERS = var.customer_csv_drive_folders
  } : k => v if v != "" }

  api_env = merge(local.common_env, { for k, v in {
    DB_POOL_MAX             = tostring(var.api_db_pool_max)
    MIRROR_TO_GOOGLE_SHEETS = tostring(var.mirror_to_google_sheets)
    GEMINI_MODEL_REPORT     = var.gemini_models.report
    GEMINI_MODEL_OCR        = var.gemini_models.ocr
  } : k => v if v != "" })

  # パスワード再設定メールは outbox 経由でワーカーが送る(API は応答時間からアカウントの有無が分からないよう送らない)
  worker_env = merge(local.common_env, { for k, v in {
    DB_POOL_MAX = "3"
    SMTP_HOST   = var.smtp.host
    SMTP_PORT   = tostring(var.smtp.port)
    SMTP_USER   = var.smtp.user
    SMTP_FROM   = var.smtp.from
  } : k => v if v != "" })

  # 環境変数名 = シークレット名(secrets.tf)。optional のものは var.optional_secrets にあるときだけ渡す。
  api_secret_env = merge(
    {
      DATABASE_URL           = "database-url"
      SESSION_SECRET         = "session-secret"
      BLIND_INDEX_MASTER_KEY = "blind-index-key"
    },
    { for k, v in {
      GOOGLE_MAPS_API_KEY = "google-maps-api-key"
      GEMINI_API_KEY      = "gemini-api-key"
      LEGACY_AUTH_SALT    = "legacy-auth-salt"
      GAS_BRIDGE_SECRET   = "gas-bridge-secret"
    } : k => v if contains(var.optional_secrets, v) },
  )
  worker_secret_env = merge(
    # ワーカーは専用の DB ユーザー(katahimo_worker。outbox をテナント横断で取るポリシーがある)
    { WORKER_DATABASE_URL = "worker-database-url" },
    { for k, v in {
      SMTP_PASS           = "smtp-pass"
      GOOGLE_MAPS_API_KEY = "google-maps-api-key"
      GAS_BRIDGE_SECRET   = "gas-bridge-secret"
    } : k => v if contains(var.optional_secrets, v) },
  )

  # Cloud Run Jobs(同じ worker イメージの別コマンド)。schedule は JST(Cloud Scheduler の time_zone)。
  jobs = {
    migrate = {
      args            = ["db/dist/migrate.js"]
      service_account = google_service_account.migrate.email
      env             = { NODE_ENV = "production", DB_POOL_MAX = "1" }
      secret_env      = { MIGRATION_DATABASE_URL = "migration-database-url" }
      max_retries     = 0
      timeout         = "600s"
      schedule        = null
    }
    # GAS版 autoSyncTodayScheduleForAllStaff(Triggers.js)
    nightly-calendar-sync = {
      args            = ["dist/nightly-calendar-sync.js"]
      service_account = google_service_account.worker.email
      env             = local.worker_env
      secret_env      = local.worker_secret_env
      max_retries     = 1 # 冪等なので失敗時に1回だけ流し直す
      timeout         = "1800s"
      schedule        = "0 22 * * *"
    }
    # GAS版 checkAndImportLatestCsv(Triggers.js)
    csv-import = {
      args            = ["dist/csv-import.js"]
      service_account = google_service_account.worker.email
      env             = local.worker_env
      secret_env      = local.worker_secret_env
      max_retries     = 1
      timeout         = "1800s"
      schedule        = "0 3 * * *"
    }
    # 保守(操作ログのパーティション・保存期間を過ぎた行・参照されないファイルの削除)
    maintenance = {
      args            = ["dist/maintenance.js"]
      service_account = google_service_account.worker.email
      env             = local.worker_env
      secret_env      = local.worker_secret_env
      max_retries     = 1
      timeout         = "1800s"
      schedule        = "0 4 * * *"
    }
    # 将来のマッチング用(doc/10)。既定では定期実行しない
    sync-busy-blocks = {
      args            = ["dist/sync-busy-blocks.js"]
      service_account = google_service_account.worker.email
      env             = local.worker_env
      secret_env      = local.worker_secret_env
      max_retries     = 1
      timeout         = "1800s"
      schedule        = null
    }
  }
}

# ── API(+ Web 画面) ───────────────────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  count               = var.deploy_workloads ? 1 : 0
  name                = "katahimo-api"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = false

  template {
    service_account                  = google_service_account.api.email
    max_instance_request_concurrency = 80
    timeout                          = "120s" # AI 生成(Gemini)の応答待ちを含む

    scaling {
      min_instance_count = 0
      max_instance_count = var.api_max_instances
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_conn_name]
      }
    }

    containers {
      image = local.api_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true # リクエスト処理中だけ課金
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.api_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      startup_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds    = 2
        failure_threshold = 15
        timeout_seconds   = 2
      }
      liveness_probe {
        http_get {
          path = "/api/health"
        }
        period_seconds = 30
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor, google_project_iam_member.cloudsql_client]
}

# アプリ自身が認証(セッションCookie)するため、Cloud Run の IAM 認証は掛けない
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count    = var.deploy_workloads ? 1 : 0
  name     = google_cloud_run_v2_service.api[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ── outbox ポーラー(常駐) ─────────────────────────────────────
# 外部からのリクエストは受けない(ヘルスチェック用に 8080 で待ち受けるだけ)。CPU を常時割り当て、
# ちょうど1インスタンスで動かす(複数あっても outbox の取り出しは排他だが、無駄なコストになる)。
resource "google_cloud_run_v2_service" "worker" {
  count               = var.deploy_workloads && var.outbox_poller_enabled ? 1 : 0
  name                = "katahimo-worker"
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = false

  template {
    service_account = google_service_account.worker.email

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [local.sql_conn_name]
      }
    }

    containers {
      image = local.worker_image
      args  = ["dist/main.js"]

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.worker_cpu
          memory = "512Mi"
        }
        cpu_idle = false
      }

      dynamic "env" {
        # WORKER_HEALTH_PORT: ヘルスチェック用の待ち受け(packages/worker/src/jobs/healthServer.ts)
        for_each = merge(local.worker_env, { WORKER_HEALTH_PORT = "8080" })
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.worker_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      startup_probe {
        tcp_socket {
          port = 8080
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor, google_project_iam_member.cloudsql_client]
}

# ── ジョブ ──────────────────────────────────────────────────
resource "google_cloud_run_v2_job" "jobs" {
  # jobs の各要素は env の中身が違う(=型の違う object)ため、キーの集合で回す
  for_each            = var.deploy_workloads ? toset(keys(local.jobs)) : toset([])
  name                = "katahimo-${each.key}"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1

    template {
      service_account = local.jobs[each.key].service_account
      max_retries     = local.jobs[each.key].max_retries
      timeout         = local.jobs[each.key].timeout

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [local.sql_conn_name]
        }
      }

      containers {
        image = local.worker_image
        args  = local.jobs[each.key].args

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }

        dynamic "env" {
          for_each = local.jobs[each.key].env
          content {
            name  = env.key
            value = env.value
          }
        }
        dynamic "env" {
          for_each = local.jobs[each.key].secret_env
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app[env.value].secret_id
                version = "latest"
              }
            }
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor, google_project_iam_member.cloudsql_client]
}
