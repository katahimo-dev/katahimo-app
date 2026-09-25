# Cloud Scheduler → Cloud Run Jobs(Admin API の jobs.run を OAuth トークン付きで呼ぶ)。
# 時刻は GAS版 Triggers.js と同じ JST(夜間反映 22:00 / 顧客CSV取込 03:00)。
locals {
  scheduled_jobs = { for name, job in local.jobs : name => job if job.schedule != null && var.deploy_workloads }
}

resource "google_cloud_scheduler_job" "jobs" {
  for_each  = local.scheduled_jobs
  name      = "katahimo-${each.key}"
  region    = var.region
  schedule  = each.value.schedule
  time_zone = "Asia/Tokyo"
  paused    = var.scheduler_paused
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
