output "sql_connection_name" {
  description = "Cloud SQL の接続名(DATABASE_URL の host=/cloudsql/<これ>。コネクタが接続名として読む)"
  value       = google_sql_database_instance.main.connection_name
}

output "image_registry" {
  description = "イメージの push 先(cloudbuild.yaml の _REGISTRY と一致させる)"
  value       = local.registry
}

output "receipts_bucket" {
  value = google_storage_bucket.receipts.name
}

output "build_staging_bucket" {
  description = "gcloud builds submit --gcs-source-staging-dir=gs://<これ>/source"
  value       = google_storage_bucket.build_staging.name
}

output "kms_keys" {
  description = "Cloud KMS の鍵(CMEK: Cloud SQL・領収書バケット / SecretBox: SECRET_BOX_KMS_KEY)"
  value = {
    cloudsql_cmek  = google_kms_crypto_key.cloudsql.id
    storage_cmek   = google_kms_crypto_key.storage.id
    tenant_secrets = google_kms_crypto_key.tenant_secrets.id
  }
}

output "service_accounts" {
  description = "カレンダー・Drive フォルダを共有する相手(api / worker。GAS版からの移行の取込は ops)と、Cloud Build の実行SA(deployer)"
  value = {
    api      = google_service_account.api.email
    worker   = google_service_account.worker.email
    migrate  = google_service_account.migrate.email
    ops      = google_service_account.ops.email
    deployer = google_service_account.deployer.email
  }
}

output "outbox_drain_job" {
  description = "outbox を処理するジョブ(API の OUTBOX_DRAIN_JOB)。手で流すときは gcloud run jobs execute katahimo-outbox-drain"
  value       = local.outbox_drain_job_id
}

output "api_url" {
  value = var.deploy_workloads ? google_cloud_run_v2_service.api[0].uri : null
}

output "ops_bucket" {
  description = "運用スクリプト(gcloud run jobs execute katahimo-ops)の入出力の置き場。ジョブからは /ops に見える(7日で消える)"
  value       = google_storage_bucket.ops.name
}

output "sql_private_ip" {
  description = "Cloud SQL のプライベート IP(VPC の中からだけ届く。接続は言語コネクタ・cloud-sql-proxy --private-ip で)"
  value       = google_sql_database_instance.main.private_ip_address
}
