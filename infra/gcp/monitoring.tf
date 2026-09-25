# Cloud Monitoring のアラート・外形監視と、請求の予算アラート(doc/11 「5. 運用」の「監視・アラート」)。
# 通知先は var.alert_emails(メール)。空でもアラート自体は作り、コンソールのインシデント一覧で見える。
#
# アラートの条件は指標(メトリクス)の名前とラベルで書くため、Cloud Run・Cloud SQL が無い段階
# (deploy_workloads = false)で作っても害はない。外形監視だけは対象の URL が必要なため、
# deploy_workloads = true か uptime_check_host を指定したときに作る。

locals {
  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  # 失敗を見張る Cloud Run Jobs(run.tf の local.jobs。migrate / nightly-calendar-sync / csv-import / sync-busy-blocks)
  monitored_job_names = [for name in keys(local.jobs) : "katahimo-${name}"]

  sql_database_id = "${var.project_id}:${var.sql_instance_name}"

  # 外形監視のホスト。Cloud Run の URL は作成するまで分からないため、count は URL ではなく変数で決める
  uptime_enabled = var.uptime_check_host != "" || var.deploy_workloads
  uptime_host = (
    var.uptime_check_host != ""
    ? var.uptime_check_host
    : trimprefix(coalesce(one(google_cloud_run_v2_service.api[*].uri), "https://"), "https://")
  )
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  display_name = "katahimo アラート(${each.value})"
  type         = "email"
  labels = {
    email_address = each.value
  }

  depends_on = [google_project_service.enabled]
}

# ── Cloud Run: API の 5xx ─────────────────────────────────────
resource "google_monitoring_alert_policy" "api_5xx" {
  display_name          = "katahimo-api: 5xx 応答の増加"
  combiner              = "OR"
  severity              = "ERROR"
  notification_channels = local.notification_channels

  conditions {
    display_name = "5 分間の 5xx 応答が ${var.alert_api_5xx_threshold} 件を超えた"
    condition_threshold {
      filter          = <<-EOT
        resource.type = "cloud_run_revision"
        AND resource.labels.service_name = "katahimo-api"
        AND metric.type = "run.googleapis.com/request_count"
        AND metric.labels.response_code_class = "5xx"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = var.alert_api_5xx_threshold
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.service_name"]
      }
      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      katahimo-api が 5xx を返している。Cloud Logging で
      `resource.type="cloud_run_revision" AND resource.labels.service_name="katahimo-api" AND severity>=ERROR`
      を確認する。直前のデプロイが原因ならリビジョンを戻す(doc/11 「5. 運用 > ロールバック」)。
    EOT
  }

  depends_on = [google_project_service.enabled]
}

# ── Cloud Run Jobs: 実行の失敗 ────────────────────────────────
resource "google_monitoring_alert_policy" "job_failed" {
  display_name          = "katahimo ジョブ: 実行の失敗"
  combiner              = "OR"
  severity              = "ERROR"
  notification_channels = local.notification_channels

  conditions {
    display_name = "ジョブの実行が失敗した(再試行を使い切った)"
    condition_threshold {
      filter          = <<-EOT
        resource.type = "cloud_run_job"
        AND resource.labels.job_name = one_of(${join(", ", [for n in local.monitored_job_names : "\"${n}\""])})
        AND metric.type = "run.googleapis.com/job/completed_execution_count"
        AND metric.labels.result = "failed"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.labels.job_name"]
      }
      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "86400s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      Cloud Run Jobs の実行が失敗した(ジョブ名はインシデントのラベル job_name)。
      `gcloud run jobs executions list --job=<ジョブ名> --region=${var.region}` と Cloud Logging
      (`resource.type="cloud_run_job" AND resource.labels.job_name="<ジョブ名>"`)で原因を確認する。
      夜間ジョブは冪等なので、原因を取り除いたら `gcloud run jobs execute <ジョブ名>` で流し直してよい。
      katahimo-migrate の失敗ではデプロイが止まっている(cloudbuild.yaml)。
    EOT
  }

  depends_on = [google_project_service.enabled]
}

# ── Cloud SQL: CPU・ディスク・接続数 ───────────────────────────
resource "google_monitoring_alert_policy" "sql" {
  display_name          = "katahimo-db: 資源の逼迫"
  combiner              = "OR"
  severity              = "WARNING"
  notification_channels = local.notification_channels

  conditions {
    display_name = "CPU 使用率が 15 分間 80% を超えた"
    condition_threshold {
      filter          = <<-EOT
        resource.type = "cloudsql_database"
        AND resource.labels.database_id = "${local.sql_database_id}"
        AND metric.type = "cloudsql.googleapis.com/database/cpu/utilization"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "900s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
      trigger {
        count = 1
      }
    }
  }

  conditions {
    display_name = "ディスク使用率が 80% を超えた"
    condition_threshold {
      filter          = <<-EOT
        resource.type = "cloudsql_database"
        AND resource.labels.database_id = "${local.sql_database_id}"
        AND metric.type = "cloudsql.googleapis.com/database/disk/utilization"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "600s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
      trigger {
        count = 1
      }
    }
  }

  conditions {
    display_name = "接続数が ${var.alert_sql_connections_threshold} を超えた"
    condition_threshold {
      filter          = <<-EOT
        resource.type = "cloudsql_database"
        AND resource.labels.database_id = "${local.sql_database_id}"
        AND metric.type = "cloudsql.googleapis.com/database/postgresql/num_backends"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = var.alert_sql_connections_threshold
      duration        = "300s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_MAX"
        cross_series_reducer = "REDUCE_SUM" # num_backends はデータベースごとの系列になるため合計する
        group_by_fields      = ["resource.labels.database_id"]
      }
      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "3600s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      Cloud SQL(${var.sql_instance_name})の資源が逼迫している。CPU は Query Insights で重いクエリを確認し、
      恒常的なら sql_tier を上げる。ディスクは自動拡張される(disk_autoresize)が、急増していれば原因を調べる。
      接続数は doc/11 「接続数の見積もり」(api_max_instances × api_db_pool_max 等)を見直す。
    EOT
  }

  depends_on = [google_project_service.enabled]
}

# ── 外形監視: /api/health ────────────────────────────────────
resource "google_monitoring_uptime_check_config" "api" {
  count        = local.uptime_enabled ? 1 : 0
  display_name = "katahimo-api /api/health"
  timeout      = "10s"
  period       = "300s"
  # 最小の3地域(API は最小0インスタンスのため、確認の頻度を上げすぎない)
  selected_regions = ["ASIA_PACIFIC", "USA_OREGON", "EUROPE"]

  http_check {
    path           = "/api/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.uptime_host
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "uptime" {
  count                 = local.uptime_enabled ? 1 : 0
  display_name          = "katahimo-api: 外形監視の失敗"
  combiner              = "OR"
  severity              = "CRITICAL"
  notification_channels = local.notification_channels

  conditions {
    display_name = "/api/health に 10 分間応答しない"
    condition_threshold {
      filter          = <<-EOT
        resource.type = "uptime_url"
        AND metric.type = "monitoring.googleapis.com/uptime_check/check_passed"
        AND metric.labels.check_id = "${google_monitoring_uptime_check_config.api[0].uptime_check_id}"
      EOT
      comparison      = "COMPARISON_GT"
      threshold_value = 1 # 失敗した地域の数(3地域のうち2つ以上で失敗)
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.labels.host"]
      }
      trigger {
        count = 1
      }
    }
  }

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = <<-EOT
      https://${local.uptime_host}/api/health が応答しない。Cloud Run の katahimo-api のリビジョンの状態と
      起動ログ(起動時の設定検証で落ちていないか)を確認する。
    EOT
  }
}

# ── 予算(請求先アカウント単位の設定。billing_account_id を指定したときだけ作る) ──
# 作業者に請求先アカウントの「請求先アカウント管理者」または「予算管理者」相当の権限が要る。
# ユーザーの ADC で apply する場合は割り当てプロジェクトの指定が必要(doc/11 「3.1」)。
data "google_project" "current" {
  count = var.billing_account_id != "" ? 1 : 0
}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id != "" ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "katahimo 月額予算(${var.project_id})"

  budget_filter {
    projects        = ["projects/${data.google_project.current[0].number}"]
    calendar_period = "MONTH"
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency_code
      units         = tostring(var.budget_amount)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  # 月末までの見込みが予算を超えそうなとき(実績が超える前に気づくため)
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    # 請求先アカウントの管理者への既定のメールに加え、アラートと同じ通知先にも送る(最大5つ)
    monitoring_notification_channels = slice(local.notification_channels, 0, min(5, length(local.notification_channels)))
    disable_default_iam_recipients   = false
  }

  depends_on = [google_project_service.enabled]
}
