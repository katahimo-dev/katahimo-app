# Secret Manager。Terraform は入れ物とアクセス権だけを作り、値(バージョン)は
#   printf '%s' "$VALUE" | gcloud secrets versions add <名前> --data-file=-
# で登録する(値を state に残さないため。doc/11 「5. シークレットの登録」)。
#
# LOCAL_DEV_KEK は本番では使わない(KMS_PROVIDER=gcp、Cloud KMS の tenant-kek を使う)。
# BLIND_INDEX_MASTER_KEY はブラインドインデックスの HMAC のマスター鍵(データの暗号化鍵とは別)。
# DB の接続はロールごとに別の secret(API = katahimo_app、ワーカー = katahimo_worker、migrate = katahimo_migrator)。
locals {
  secrets = {
    # 名前 = 読めるサービスアカウント
    "database-url"           = ["api"]     # postgres://katahimo_app:...@/katahimo?host=/cloudsql/<接続名>
    "worker-database-url"    = ["worker"]  # postgres://katahimo_worker:...@/katahimo?host=/cloudsql/<接続名>
    "migration-database-url" = ["migrate"] # postgres://katahimo_migrator:...@/katahimo?host=/cloudsql/<接続名>
    "session-secret"         = ["api"]
    "blind-index-key"        = ["api"] # BLIND_INDEX_MASTER_KEY
    "legacy-auth-salt"       = ["api"] # GAS版の AUTH_SALT(移行期のみ)
    "smtp-pass"              = ["worker"] # パスワード再設定メールはワーカーが送る
    "gemini-api-key"         = ["api"]
    "google-maps-api-key"    = ["api", "worker"]
    "gas-bridge-secret"      = ["api", "worker"]
  }

  secret_accessors = merge([
    for secret, accessors in local.secrets : {
      for accessor in accessors : "${secret}/${accessor}" => { secret = secret, accessor = accessor }
    }
  ]...)

  runtime_service_accounts = {
    api     = google_service_account.api.email
    worker  = google_service_account.worker.email
    migrate = google_service_account.migrate.email
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secrets
  secret_id = "katahimo-${each.key}"

  # 日本国内(東京)にだけ保存する
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_iam_member" "accessor" {
  for_each  = local.secret_accessors
  secret_id = google_secret_manager_secret.app[each.value.secret].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${local.runtime_service_accounts[each.value.accessor]}"
}
