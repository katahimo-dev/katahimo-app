output "sql_connection_name" {
  description = "Cloud SQL の接続名(DATABASE_URL の host=/cloudsql/<これ>、cloud-sql-proxy の引数)"
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
  description = "カレンダー・Drive フォルダを共有する相手(api / worker)と、Cloud Build の実行SA(deployer)"
  value = {
    api      = google_service_account.api.email
    worker   = google_service_account.worker.email
    migrate  = google_service_account.migrate.email
    deployer = google_service_account.deployer.email
  }
}

output "api_url" {
  value = var.deploy_workloads ? google_cloud_run_v2_service.api[0].uri : null
}
