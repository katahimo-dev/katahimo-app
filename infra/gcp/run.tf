# Cloud Run(サービス: api、ジョブ: migrate / outbox-drain / 夜間バッチ)。
# イメージの更新は cloudbuild.yaml(gcloud run deploy / jobs update)が行うため、Terraform は image の
# 差分を無視する。env やリソース量の変更は Terraform で行う。

locals {
  registry      = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  api_image     = "${local.registry}/api:${var.image_tag}"
  worker_image  = "${local.registry}/worker:${var.image_tag}"
  sql_conn_name = google_sql_database_instance.main.connection_name

  # outbox を処理するジョブ。API が outbox に積んだ操作のコミットの後に jobs.run で起動を頼む(OUTBOX_DRAIN_JOB)
  outbox_drain_job_name = "katahimo-outbox-drain"
  outbox_drain_job_id   = "projects/${var.project_id}/locations/${var.region}/jobs/${local.outbox_drain_job_name}"

  # API・ワーカー・夜間ジョブ共通(packages/api/src/env.ts / packages/worker/src/env.ts)。空の値は渡さない。
  # MIRROR_TO_GOOGLE_SHEETS・GAS_BRIDGE_* は API(積む)とワーカー(送る)で同じ値にする(packages/integrations の sharedEnvShape)。
  common_env = { for k, v in {
    NODE_ENV                = "production"
    STORAGE_PROVIDER        = "gcs"
    GCS_BUCKET              = google_storage_bucket.receipts.name
    SCHEDULE_PROVIDER       = var.schedule_provider
    GAS_BRIDGE_URL          = var.gas_bridge_url
    GAS_BRIDGE_TENANT       = var.gas_bridge_tenant
    MIRROR_TO_GOOGLE_SHEETS = tostring(var.mirror_to_google_sheets)
    VAPID_PUBLIC_KEY        = var.web_push.public_key
  } : k => v if v != "" }

  api_env = merge(local.common_env, { for k, v in {
    DB_POOL_MAX         = tostring(var.api_db_pool_max)
    OUTBOX_DRAIN_JOB    = local.outbox_drain_job_id
    SECRET_BOX_PROVIDER = "gcp"
    SECRET_BOX_KMS_KEY  = google_kms_crypto_key.tenant_secrets.id
  } : k => v if v != "" })

  # パスワード再設定メール・Web Push・ミラーは outbox 経由でジョブ(outbox-drain・バッチのジョブの最後)が送る
  # (API は応答時間からアカウントの有無が分からないよう、再設定メールを自分では送らない)
  worker_env = merge(local.common_env, { for k, v in {
    DB_POOL_MAX    = "3"
    SMTP_HOST      = var.smtp.host
    SMTP_PORT      = tostring(var.smtp.port)
    SMTP_USER      = var.smtp.user
    SMTP_FROM      = var.smtp.from
    VAPID_SUBJECT  = var.web_push.subject
    APP_PUBLIC_URL = var.app_public_url
  } : k => v if v != "" })

  # 環境変数名 = シークレット名(secrets.tf)。optional のものは var.optional_secrets にあるときだけ渡す。
  api_secret_env = merge(
    {
      DATABASE_URL   = "database-url"
      SESSION_SECRET = "session-secret"
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
      VAPID_PRIVATE_KEY   = "vapid-private-key"
    } : k => v if contains(var.optional_secrets, v) },
  )

  # Cloud Run Jobs(同じ worker イメージの別コマンド)。schedule は JST(Cloud Scheduler の time_zone)。
  # pause_until_cutover = true の定期実行は var.scheduler_paused の間止めておく(GAS版の同じ時限トリガーとの二重実行を防ぐ)。
  jobs = {
    migrate = {
      args                = ["db/dist/migrate.js"]
      service_account     = google_service_account.migrate.email
      env                 = { NODE_ENV = "production", DB_POOL_MAX = "1" }
      secret_env          = { MIGRATION_DATABASE_URL = "migration-database-url" }
      max_retries         = 0
      timeout             = "600s"
      memory              = "1Gi"
      schedule            = null
      pause_until_cutover = false
    }
    # outbox(スプレッドシートへのミラー・パスワード再設定メール・Web Push)を空になるまで処理して終わる。
    # 起動は2通り: API が outbox に積んだ操作の後に頼む(OUTBOX_DRAIN_JOB)のと、Cloud Scheduler の見回り
    # (var.outbox_sweep_schedule。再試行の待ちと、起動を頼めなかった分を拾う)。実行が重なっても取り出しは排他。
    # 再設定メールは切替日の前から要るため、見回りは scheduler_paused でも止めない。
    outbox-drain = {
      args            = ["dist/outbox-once.js"]
      service_account = google_service_account.worker.email
      # 1件ずつ順に処理し、2本の接続を同時に要る処理が無いため接続は1本(トランザクションの中の複数の問い合わせは
      # そのトランザクションの接続に並ぶ)。実行が重なる分を DB の接続数に残す(doc/07_インフラ・運用.md 2.1)。
      # 上限時間(timeout)より前に区切りで止めて終える(JOB_TIMEOUT_MS)
      env                 = merge(local.worker_env, { DB_POOL_MAX = "1", JOB_TIMEOUT_MS = "540000" })
      secret_env          = local.worker_secret_env
      max_retries         = 0 # 送れなかったメッセージは outbox の再試行(available_at)で次の実行が取る
      timeout             = "600s"
      memory              = "512Mi"
      schedule            = var.outbox_sweep_schedule
      pause_until_cutover = false
    }
    # GAS版 autoSyncTodayScheduleForAllStaff(Triggers.js)
    nightly-calendar-sync = {
      args                = ["dist/nightly-calendar-sync.js"]
      service_account     = google_service_account.worker.email
      env                 = local.worker_env
      secret_env          = local.worker_secret_env
      max_retries         = 1 # 冪等なので失敗時に1回だけ流し直す
      timeout             = "1800s"
      memory              = "1Gi"
      schedule            = "0 22 * * *"
      pause_until_cutover = true
    }
    # 翌日の予定のお知らせ(Web Push)。GAS版 gas-root-serach の夜間 main() の LINE WORKS DM の置き換え
    route-notice = {
      args                = ["dist/route-notice.js"]
      service_account     = google_service_account.worker.email
      env                 = local.worker_env
      secret_env          = local.worker_secret_env
      max_retries         = 1 # スタッフ × 日付で1件なので流し直してよい
      timeout             = "1800s"
      memory              = "1Gi"
      schedule            = var.route_notice_schedule
      pause_until_cutover = true
    }
    # GAS版 checkAndImportLatestCsv(Triggers.js)
    csv-import = {
      args                = ["dist/csv-import.js"]
      service_account     = google_service_account.worker.email
      env                 = local.worker_env
      secret_env          = local.worker_secret_env
      max_retries         = 1
      timeout             = "1800s"
      memory              = "1Gi"
      schedule            = "0 3 * * *"
      pause_until_cutover = true
    }
    # 保守(操作ログのパーティション・保存期間を過ぎた行・参照されないファイルの削除)
    maintenance = {
      args                = ["dist/maintenance.js"]
      service_account     = google_service_account.worker.email
      env                 = local.worker_env
      secret_env          = local.worker_secret_env
      max_retries         = 1
      timeout             = "1800s"
      memory              = "1Gi"
      schedule            = "0 4 * * *"
      pause_until_cutover = true
    }
    # 将来のマッチング用(doc/10_マッチング拡張設計.md)。既定では定期実行しない
    sync-busy-blocks = {
      args                = ["dist/sync-busy-blocks.js"]
      service_account     = google_service_account.worker.email
      env                 = local.worker_env
      secret_env          = local.worker_secret_env
      max_retries         = 1
      timeout             = "1800s"
      memory              = "1Gi"
      schedule            = null
      pause_until_cutover = true
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

# ── ジョブ ──────────────────────────────────────────────────
resource "google_cloud_run_v2_job" "jobs" {
  # jobs の各要素は env の中身が違う(=型の違う object)ため、キーの集合で回す
  for_each            = var.deploy_workloads ? toset(keys(local.jobs)) : toset([])
  name                = "katahimo-${each.key}"
  location            = var.region
  deletion_protection = false

  template {
    task_count  = 1
    parallelism = 1

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
            memory = local.jobs[each.key].memory
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

    # Web Push は公開鍵・連絡先・秘密鍵の3つが揃って使える(ワーカーのジョブは片方だけの設定では起動しない)
    precondition {
      condition = (
        (var.web_push.public_key == "") == (var.web_push.subject == "") &&
        (var.web_push.public_key == "") == !contains(var.optional_secrets, "vapid-private-key")
      )
      error_message = "web_push.public_key・web_push.subject・optional_secrets の vapid-private-key は3つとも設定するか、3つとも外してください。"
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.accessor, google_project_iam_member.cloudsql_client]
}
