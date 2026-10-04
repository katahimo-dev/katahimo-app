# Cloud Scheduler → Cloud Run Jobs(Admin API の jobs.run を OAuth トークン付きで呼ぶ)。
# 時刻は JST。夜間反映 22:00 は GAS版 Triggers.js と同じ、顧客CSV取込は var.customer_csv_import_schedule(既定 10 分ごと。
# GAS版は毎日3時台)、翌日の予定のお知らせは var.route_notice_schedule(既定 19:00。GAS版 gas-root-serach の
# 夜間 main() の置き換え)、保守 04:00。
# outbox の見回り(outbox-drain)は var.outbox_sweep_schedule(既定 10 分ごと)で、scheduler_paused でも止めない。
locals {
  scheduled_jobs = { for name, job in local.jobs : name => job if job.schedule != null && var.deploy_workloads }
}

resource "google_cloud_scheduler_job" "jobs" {
  for_each  = local.scheduled_jobs
  name      = "katahimo-${each.key}"
  region    = var.region
  schedule  = each.value.schedule
  time_zone = "Asia/Tokyo"
  paused    = each.value.pause_until_cutover && var.scheduler_paused
  # jobs.run は実行の開始を受け付けた時点で応答する(ジョブの完了は待たない)
  attempt_deadline = "60s"

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/${google_cloud_run_v2_job.jobs[each.key].id}:run"

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.enabled]
}

# 起動するジョブに対してだけ実行権限(run.jobs.run)を付ける
resource "google_cloud_run_v2_job_iam_member" "scheduler_invoker" {
  for_each = local.scheduled_jobs
  name     = google_cloud_run_v2_job.jobs[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# API は outbox に積んだ操作の後に outbox-drain の実行を頼む(OUTBOX_DRAIN_JOB)。そのジョブにだけ run.jobs.run を付ける。
# 上書き(overrides)付きの実行は使わないため roles/run.jobsExecutorWithOverrides は付けない。
resource "google_cloud_run_v2_job_iam_member" "api_outbox_drain" {
  count    = var.deploy_workloads ? 1 : 0
  name     = google_cloud_run_v2_job.jobs["outbox-drain"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.api.email}"
}

# 運用スクリプト(ops)もテナントの作成等で outbox に積むため、同じく outbox-drain の実行を頼める
resource "google_cloud_run_v2_job_iam_member" "ops_outbox_drain" {
  count    = var.deploy_workloads ? 1 : 0
  name     = google_cloud_run_v2_job.jobs["outbox-drain"].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.ops.email}"
}
