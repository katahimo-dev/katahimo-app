# Secret Manager。Terraform は入れ物とアクセス権だけを作り、値(バージョン)は
#   printf '%s' "$VALUE" | gcloud secrets versions add <名前> --data-file=-
# で登録する(値を state に残さないため。doc/07_インフラ・運用.md 3.3)。
#
# テナントの秘密値の封(SecretBox)は Cloud KMS の tenant-secrets(kms.tf)を使う。KMS を使わないデモ専用の環境(demo_mode)だけ
# secret-box-local-key(下)を使う。
# DB の接続はロールごとに別の secret(API = katahimo_app、ワーカー = katahimo_worker、migrate = katahimo_migrator)。
# ops(運用スクリプト)は API と同じ値 + 所有者の接続(テナントの作成・設定は MIGRATION_DATABASE_URL で行う)。
locals {
  secrets = merge({
    # 名前 = 読めるサービスアカウント
    "database-url"           = concat(["api", "ops"], var.demo_mode ? ["demo-reset"] : [])     # postgres://katahimo_app:...@/katahimo?host=/cloudsql/<接続名>
    "worker-database-url"    = ["worker"]                                                      # postgres://katahimo_worker:...@/katahimo?host=/cloudsql/<接続名>
    "migration-database-url" = concat(["migrate", "ops"], var.demo_mode ? ["demo-reset"] : []) # postgres://katahimo_migrator:...@/katahimo?host=/cloudsql/<接続名>
    "session-secret"         = concat(["api", "ops"], var.demo_mode ? ["demo-reset"] : [])
    "legacy-auth-salt"       = var.demo_mode ? [] : ["api", "ops"] # GAS版の AUTH_SALT(移行期のみ)
    "smtp-pass"              = var.demo_mode ? [] : ["worker"]     # パスワード再設定メールはワーカーが送る
    "gemini-api-key"         = var.demo_mode ? [] : ["api", "ops"]
    "google-maps-api-key"    = var.demo_mode ? [] : ["api", "worker", "ops"]
    "gas-bridge-secret"      = var.demo_mode ? [] : ["api", "worker", "ops"]
    "vapid-private-key"      = var.demo_mode ? [] : ["worker"] # Web Push の VAPID の秘密鍵(送信はワーカー。公開鍵は var.web_push)
    }, var.demo_mode ? {
    # デモ専用の環境の秘密値の封の鍵(SECRET_BOX_PROVIDER=local。64桁の16進数。openssl rand -hex 32)。本番は Cloud KMS(kms.tf)
    "secret-box-local-key" = ["api", "ops", "demo-reset"]
  } : {})

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
      ops     = google_service_account.ops.email
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
