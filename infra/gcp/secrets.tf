# Secret Manager。Terraform は入れ物とアクセス権だけを作り、値(バージョン)は
#   printf '%s' "$VALUE" | gcloud secrets versions add <名前> --data-file=-
# で登録する(値を state に残さないため。doc/07_インフラ・運用.md 3.3)。
#
# テナントの秘密値の封(SecretBox)は Secret Manager ではなく Cloud KMS の tenant-secrets(kms.tf)を使う。
# DB の接続はロールごとに別の secret(API = katahimo_app、ワーカー = katahimo_worker、migrate = katahimo_migrator)。
locals {
  secrets = {
    # 名前 = 読めるサービスアカウント
    "database-url"           = var.demo_mode ? ["api", "demo-reset"] : ["api"]         # postgres://katahimo_app:...@/katahimo?host=/cloudsql/<接続名>
    "worker-database-url"    = ["worker"]                                              # postgres://katahimo_worker:...@/katahimo?host=/cloudsql/<接続名>
    "migration-database-url" = var.demo_mode ? ["migrate", "demo-reset"] : ["migrate"] # postgres://katahimo_migrator:...@/katahimo?host=/cloudsql/<接続名>
    "session-secret"         = var.demo_mode ? ["api", "demo-reset"] : ["api"]
    "legacy-auth-salt"       = var.demo_mode ? [] : ["api"]    # GAS版の AUTH_SALT(移行期のみ)
    "smtp-pass"              = var.demo_mode ? [] : ["worker"] # パスワード再設定メールはワーカーが送る
    "gemini-api-key"         = var.demo_mode ? [] : ["api"]
    "google-maps-api-key"    = var.demo_mode ? [] : ["api", "worker"]
    "gas-bridge-secret"      = var.demo_mode ? [] : ["api", "worker"]
    "vapid-private-key"      = var.demo_mode ? [] : ["worker"] # Web Push の VAPID の秘密鍵(送信はワーカー。公開鍵は var.web_push)
  }

  secret_accessors = merge([
    for secret, accessors in local.secrets : {
      for accessor in accessors : "${secret}/${accessor}" => { secret = secret, accessor = accessor }
    }
  ]...)

  runtime_service_accounts = merge(
    {
      api     = google_service_account.api.email
      worker  = google_service_account.worker.email
      migrate = google_service_account.migrate.email
    },
    # demo_mode のときだけ(作り直しの Job のサービスアカウント)
    { for sa in google_service_account.demo_reset : "demo-reset" => sa.email },
  )
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
