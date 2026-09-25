# Cloud SQL for PostgreSQL。
# - 接続は Cloud Run の Cloud SQL 接続(Auth Proxy、Unix ソケット /cloudsql/<接続名>)だけ。パブリックIPは
#   持つが承認済みネットワークを登録しないため、Auth Proxy / コネクタ以外からは接続できない
#   (プライベートIPにすると VPC とサーバーレスVPCアクセス等が別途必要になる。doc/11 「接続方式」)。
# - DB・ロールは Terraform では作らない(infra/cloudsql/*.sql。google_sql_user で作ると
#   cloudsqlsuperuser のメンバーになってしまい、パスワードも state に残るため)。
#   組み込みの postgres ユーザーのパスワードは gcloud sql users set-password で設定する。
resource "google_sql_database_instance" "main" {
  name                = var.sql_instance_name
  region              = var.region
  database_version    = var.sql_database_version
  deletion_protection = var.sql_deletion_protection

  settings {
    # PostgreSQL 16 以降の新規インスタンスは既定が Enterprise Plus になるため明示する(共有コアは Enterprise のみ)
    edition                     = "ENTERPRISE"
    tier                        = var.sql_tier
    availability_type           = var.sql_high_availability ? "REGIONAL" : "ZONAL"
    disk_type                   = "PD_SSD"
    disk_size                   = 10
    disk_autoresize             = true
    deletion_protection_enabled = var.sql_deletion_protection

    ip_configuration {
      ipv4_enabled = true
      # 直接の TCP 接続には TLS を必須にする(Auth Proxy 経由の接続はプロキシが暗号化する)
      ssl_mode = "ENCRYPTED_ONLY"
    }

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

  depends_on = [google_project_service.enabled]
}
