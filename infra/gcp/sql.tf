# Cloud SQL for PostgreSQL。
# - プライベート IP だけ(VPC。network.tf)。パブリック IP は持たない(var.sql_public_ip で一時的に付けられる)。
#   接続は Cloud Run(API・ジョブ)から Direct VPC egress + Cloud SQL の言語コネクタ(CLOUD_SQL_IP_TYPE=PRIVATE)だけで、
#   connector_enforcement = REQUIRED で Auth Proxy / コネクタ以外の直接の接続は断る(VPC の中からでもパスワードだけでは
#   つなげない)。手元からの運用は ops ジョブ(run.tf)で行う(doc/07_インフラ・運用.md 2.1・3.6)。
# - DB・ロールは Terraform では作らない(infra/cloudsql/*.sql。google_sql_user で作ると
#   cloudsqlsuperuser のメンバーになってしまい、パスワードも state に残るため)。
#   組み込みの postgres ユーザーのパスワードは gcloud sql users set-password で設定する。
# - ディスク・バックアップ・リードレプリカはこのアプリ専用の鍵(CMEK。kms.tf)で暗号化する。鍵はインスタンスの
#   作成時にしか指定できない(変えるとインスタンスの作り直しになる)。
resource "google_sql_database_instance" "main" {
  name                = var.sql_instance_name
  region              = var.region
  database_version    = var.sql_database_version
  deletion_protection = var.sql_deletion_protection
  encryption_key_name = google_kms_crypto_key.cloudsql.id

  settings {
    # PostgreSQL 16 以降の新規インスタンスは既定が Enterprise Plus になるため明示する(共有コアは Enterprise のみ)。
    # 共有コア(既定の db-f1-micro)でも CMEK・自動バックアップ・PITR・HA・Query Insights は使える(SLA は対象外)。
    # database_flags は設定しない(max_connections・メモリの設定は tier ごとの Cloud SQL の既定のまま)
    edition                     = "ENTERPRISE"
    tier                        = var.sql_tier
    availability_type           = var.sql_high_availability ? "REGIONAL" : "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = true
    deletion_protection_enabled = var.sql_deletion_protection

    ip_configuration {
      ipv4_enabled    = var.sql_public_ip
      private_network = google_compute_network.main.id
      # 直接の TCP 接続には TLS を必須にする(Auth Proxy 経由の接続はプロキシが暗号化する)
      ssl_mode = "ENCRYPTED_ONLY"
    }

    # Cloud SQL Auth Proxy・Cloud SQL のコネクタ(Cloud Run の Cloud SQL 接続を含む)以外の接続を断る。
    # 承認済みネットワークを誤って足しても、パスワードだけでは直接つなげない(IAM の cloudsql.client が要る)。
    # psql を IP に直接つなぐ・gcloud sql connect(承認済みネットワークを一時的に足す)は使えない
    connector_enforcement = "REQUIRED"

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      # UTC。JST 01:00(夜間反映 22:00 と顧客CSV取込 03:00 の間)
      start_time                     = "16:00"
      location                       = var.region
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 14
      }
    }

    # UTC の月曜 17時 = JST 月曜 02:00(利用の少ない時間帯)
    maintenance_window {
      day          = 1
      hour         = 17
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled = true
    }

    user_labels = {
      app = "katahimo"
    }
  }

  # Cloud SQL のサービスエージェントが鍵を使えるようになってから作る(権限の反映を待つ)
  depends_on = [
    google_project_service.enabled,
    time_sleep.cmek_iam_propagation,
    google_service_networking_connection.private_services,
  ]
}
