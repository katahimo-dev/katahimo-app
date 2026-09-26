variable "project_id" {
  description = "GCP プロジェクトID"
  type        = string
}

variable "region" {
  description = "リージョン(Cloud Run / Cloud SQL / Scheduler / Artifact Registry / GCS / KMS を同じ場所に置く)"
  type        = string
  default     = "asia-northeast1"
}

variable "deploy_workloads" {
  description = <<-EOT
    Cloud Run サービス・ジョブ・Scheduler を作るか。初回は false で基盤(Cloud SQL・Secret Manager の入れ物・
    Artifact Registry 等)だけを作り、ロール作成・シークレット登録・イメージの push を済ませてから true にする
    (Cloud Run はシークレットのバージョンとイメージが存在しないと作成に失敗するため)。
  EOT
  type        = bool
  default     = false
}

variable "image_tag" {
  description = "初回作成時に使うイメージのタグ。以後のイメージ更新は cloudbuild.yaml が行う(Terraform は image の差分を無視する)"
  type        = string
  default     = "latest"
}

# ── Cloud SQL ────────────────────────────────────────────────
variable "sql_instance_name" {
  type    = string
  default = "katahimo-db"
}

variable "sql_database_version" {
  description = "PostgreSQL のメジャーバージョン。CI(.github/workflows/ci.yml)と infra/docker-compose.yml も同じメジャーにする(ローカルに直接入れる場合は 16 以上)"
  type        = string
  default     = "POSTGRES_17"
}

variable "sql_tier" {
  description = "マシンタイプ。db-g1-small は共有コア(SLA対象外)。実データ投入後に余裕を見て db-custom-1-3840 等へ"
  type        = string
  default     = "db-g1-small"
}

variable "sql_high_availability" {
  description = "true でリージョナル(HA)構成。料金は約2倍"
  type        = bool
  default     = false
}

variable "sql_deletion_protection" {
  type    = bool
  default = true
}

# ── アプリの設定(秘密でないもの) ───────────────────────────────
variable "schedule_provider" {
  description = "SCHEDULE_PROVIDER(google / gas_bridge / noop)。doc/05_バッチ・外部連携.md"
  type        = string
  default     = "google"
}

variable "google_calendar_ids" {
  description = "GOOGLE_CALENDAR_IDS(staff.calendar_id 以外に読むカレンダー。カンマ区切り)"
  type        = string
  default     = ""
}

variable "gas_bridge_url" {
  description = "GAS_BRIDGE_URL(稼働中の gas-childcare-visit-app の Web App /exec)。空ならミラー送信しない"
  type        = string
  default     = ""
}

variable "mirror_to_google_sheets" {
  description = "MIRROR_TO_GOOGLE_SHEETS(移行期にスプレッドシートへミラーするか)"
  type        = bool
  default     = false
}

variable "customer_csv_drive_folders" {
  description = "CUSTOMER_CSV_DRIVE_FOLDERS({\"テナントslug\":\"DriveフォルダID\"} の JSON)"
  type        = string
  default     = ""
}

variable "smtp" {
  description = "パスワード再設定メールの SMTP(パスワードは Secret Manager の smtp-pass)"
  type = object({
    host = string
    port = number
    user = string
    from = string
  })
}

variable "gemini_models" {
  description = "GEMINI_MODEL_REPORT / GEMINI_MODEL_OCR(空ならアプリ既定)"
  type = object({
    report = string
    ocr    = string
  })
  default = { report = "", ocr = "" }
}

variable "web_push" {
  description = <<-EOT
    Web Push(翌日の予定のお知らせ)の VAPID の公開鍵(VAPID_PUBLIC_KEY)と連絡先(VAPID_SUBJECT。mailto: か https:)。
    鍵は pnpm push:vapid-keys で作り、秘密鍵は Secret Manager の vapid-private-key に登録して optional_secrets に足す。
    public_key が空なら通知は使わない(doc/07_インフラ・運用.md)。
  EOT
  type = object({
    public_key = string
    subject    = string
  })
  default = { public_key = "", subject = "" }
}

variable "route_notice_schedule" {
  description = "翌日の予定のお知らせ(job:route-notice)を積む時刻(cron、JST)。GAS版 gas-root-serach の夜間 main() の置き換え"
  type        = string
  default     = "0 19 * * *"
}

# ── Cloud Run の規模 ──────────────────────────────────────────
variable "api_max_instances" {
  description = "API の最大インスタンス数。DB接続数 = これ × DB_POOL_MAX(+ワーカー・ジョブ)を Cloud SQL の max_connections 未満に保つ"
  type        = number
  default     = 3
}

variable "api_db_pool_max" {
  description = "API 1インスタンスあたりの DB 接続数(DB_POOL_MAX)"
  type        = number
  default     = 5
}

variable "worker_cpu" {
  description = "常駐ワーカーの vCPU(CPU 常時割り当て・最小1インスタンスのため、ここが固定費になる)"
  type        = string
  default     = "1"
}

variable "optional_secrets" {
  description = <<-EOT
    値を登録して Cloud Run に渡す任意のシークレット(secrets.tf の名前)。Cloud Run はバージョンの無い
    シークレットを参照すると起動できないため、値を登録したものだけをここに列挙する。
    database-url / worker-database-url / migration-database-url / session-secret は常に必須。
  EOT
  type        = set(string)
  default     = ["smtp-pass", "google-maps-api-key", "gemini-api-key", "legacy-auth-salt"]

  validation {
    condition = alltrue([
      for s in var.optional_secrets :
      contains(["smtp-pass", "google-maps-api-key", "gemini-api-key", "legacy-auth-salt", "gas-bridge-secret", "vapid-private-key"], s)
    ])
    error_message = "optional_secrets は smtp-pass / google-maps-api-key / gemini-api-key / legacy-auth-salt / gas-bridge-secret / vapid-private-key から選んでください。"
  }
}

variable "outbox_poller_enabled" {
  description = <<-EOT
    outbox ポーラー(常駐の katahimo-worker サービス)を動かすか。パスワード再設定メールも outbox 経由で
    ワーカーが送るため、本番では true のままにすること(false にすると再設定メールが届かない)。
  EOT
  type        = bool
  default     = true
}

variable "scheduler_paused" {
  description = <<-EOT
    夜間ジョブの Cloud Scheduler を一時停止状態で作るか。GAS版の同じ時限トリガー(Triggers.js)を止める
    切替日まで true にしておき、二重反映・二重取込を防ぐ(doc/09_移行計画.md)。
  EOT
  type        = bool
  default     = true
}

# ── 監視・予算(monitoring.tf) ──────────────────────────────────
variable "alert_emails" {
  description = "アラート・予算通知を送るメールアドレス。空ならアラートは作るが通知先なし(コンソールでのみ見える)"
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for e in var.alert_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", e))])
    error_message = "alert_emails にはメールアドレスを指定してください。"
  }
}

variable "alert_api_5xx_threshold" {
  description = "API の 5xx 応答が 5 分間にこの件数を超えたらアラート(利用者が少ないため割合ではなく件数で見る)"
  type        = number
  default     = 5
}

variable "alert_sql_connections_threshold" {
  description = "Cloud SQL の接続数(num_backends)がこれを超えたらアラート。max_connections(db-g1-small は 50 程度、要確認)の 8 割を目安にする"
  type        = number
  default     = 40
}

variable "uptime_check_host" {
  description = "外形監視(/api/health)の対象ホスト。空なら Cloud Run の既定 URL(*.run.app)。独自ドメインにしたらそのホスト名"
  type        = string
  default     = ""
}

variable "billing_account_id" {
  description = "予算アラートを作る請求先アカウントID(XXXXXX-XXXXXX-XXXXXX)。空なら予算を作らない"
  type        = string
  default     = ""
}

variable "budget_amount" {
  description = "月の予算額(budget_currency_code の単位)。50% / 90% / 100%(実績)と 100%(予測)で通知する"
  type        = number
  default     = 30000
}

variable "budget_currency_code" {
  description = "予算の通貨。請求先アカウントの通貨と同じにする必要がある"
  type        = string
  default     = "JPY"
}
