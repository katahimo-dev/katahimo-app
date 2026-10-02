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
  description = "マシンタイプ。db-f1-micro は共有コア(0.2 vCPU 相当・メモリ 0.6GB、max_connections 25 程度で要確認。Cloud SQL の SLA の対象外)で、1テナント・スタッフ10人程度の規模向け。テナント・利用が増えて CPU・メモリ・接続数のアラートが続くようになったら、db-g1-small(1.7GB・max_connections 50 程度)か SLA のある専用コアの db-custom-1-3840(1 vCPU・3.75GB)/ db-custom-2-7680 へ上げる。変えて apply するとインスタンスが数分再起動する(データは残る)。doc/07_インフラ・運用.md 2.2"
  type        = string
  default     = "db-f1-micro"
}

variable "sql_high_availability" {
  description = "true でリージョナル(HA)構成。料金は約2倍。共有コアは HA でも SLA の対象外のため、HA にするときは専用コア(db-custom-*)にする"
  type        = bool
  default     = false
}

variable "sql_deletion_protection" {
  type    = bool
  default = true
}

# ── アプリの設定(秘密でないもの) ───────────────────────────────
variable "schedule_provider" {
  description = "SCHEDULE_PROVIDER(google / gas_bridge / database / noop)。doc/05_バッチ・外部連携.md"
  type        = string
  default     = "google"
}

variable "gas_bridge_url" {
  description = "GAS_BRIDGE_URL(稼働中の gas-childcare-visit-app の Web App /exec)。空なら Bridge を使わない"
  type        = string
  default     = ""
}

variable "gas_bridge_tenant" {
  description = "GAS_BRIDGE_TENANT(Bridge の持ち主のテナントの slug。予定の取得・ミラーはこのテナントだけ。gas_bridge_url と一緒に設定する)"
  type        = string
  default     = ""
}

variable "mirror_to_google_sheets" {
  description = "MIRROR_TO_GOOGLE_SHEETS(移行期に gas_bridge_tenant のテナントの記録をスプレッドシートへミラーするか)"
  type        = bool
  default     = false
}

variable "app_public_url" {
  description = "APP_PUBLIC_URL(画面の URL。パスワード設定の案内のメールに書く。空なら書かない)"
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

variable "outbox_sweep_schedule" {
  description = <<-EOT
    outbox の見回り(outbox-drain)を起動する間隔(cron、JST)。操作の後の起動は API が頼むため、ここで拾うのは
    再試行の待ち(available_at を過ぎたもの)と、起動を頼めなかった分。scheduler_paused でも止めない。
  EOT
  type        = string
  default     = "*/10 * * * *"
}

variable "customer_csv_import_schedule" {
  description = <<-EOT
    顧客CSVの取込(job:csv-import)を起動する間隔(cron、JST)。新しいお客様は初回の訪問の直前に登録されることがあり、
    日報を書くまでに取り込むため10分ごと(outbox の見回りと同じ分にならないよう5分ずらす)。新しいCSVが無ければ
    フォルダの一覧を見るだけで終わる。急ぐときは画面の「今すぐ取り込む」(コーディネーター・管理者)。GAS版は毎日3時台
  EOT
  type        = string
  default     = "5-59/10 * * * *"
}

variable "route_notice_schedule" {
  description = "翌日の予定のお知らせ(job:route-notice)を積む時刻(cron、JST)。GAS版 gas-root-serach の夜間 main() の置き換え"
  type        = string
  default     = "0 19 * * *"
}

# ── Cloud Run の規模 ──────────────────────────────────────────
variable "api_max_instances" {
  description = "API の最大インスタンス数。DB接続数 = これ × api_db_pool_max(+ワーカー・ジョブ・運用者)を Cloud SQL の max_connections から予約分を引いた数より十分小さく保つ(doc/07_インフラ・運用.md 2.1)"
  type        = number
  default     = 2
}

variable "api_db_pool_max" {
  description = "API 1インスタンスあたりの DB 接続数(DB_POOL_MAX)"
  type        = number
  default     = 4
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

variable "scheduler_paused" {
  description = <<-EOT
    夜間ジョブの Cloud Scheduler を一時停止状態で作るか。GAS版の同じ時限トリガー(Triggers.js)を止める
    切替日まで true にしておき、二重反映・二重取込を防ぐ(doc/09_移行計画.md)。outbox の見回り
    (outbox_sweep_schedule)は対象外で、常に動かす。
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
  description = "Cloud SQL の接続数(num_backends)がこれを超えたらアラート。max_connections(db-f1-micro は 25 程度、要確認)の 8 割を目安にする。sql_tier を上げたら合わせて上げる"
  type        = number
  default     = 20
}

variable "alert_outbox_trigger_failures_threshold" {
  description = "API が outbox-drain の起動を頼めなかった回数(1時間)がこれを超えたらアラート(一時的な失敗は見回りが拾うため、続くときだけ知らせる)"
  type        = number
  default     = 3
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
  default     = 10000
}

variable "budget_currency_code" {
  description = "予算の通貨。請求先アカウントの通貨と同じにする必要がある"
  type        = string
  default     = "JPY"
}

# ── リリース(iam.tf。doc/07_インフラ・運用.md 4.1) ─────────────────
variable "cloudbuild_github_connection" {
  description = "Cloud Build の第 2 世代の GitHub 接続の名前(本番は github1)。katahimo-deployer にその接続の読み取りトークン(roles/cloudbuild.readTokenAccessor)を付け、cloudbuild.yaml の verify-source がタグ・main を確かめられるようにする。空なら付けない(接続を作る前)。cloudbuild.yaml の _SOURCE_REPOSITORY と揃える"
  type        = string
  default     = ""
}

variable "release_approvers" {
  description = "トリガー katahimo-release のビルドを承認できる運用担当者(roles/cloudbuild.builds.approver)。\"user:<メールアドレス>\" の形で人を名前で挙げる"
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for m in var.release_approvers : can(regex("^user:[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", m))])
    error_message = "release_approvers は \"user:<メールアドレス>\" の形で人だけを挙げてください。"
  }
}

# ── 監査ログ(iam.tf。doc/07_インフラ・運用.md 6章) ─────────────────
variable "data_access_audit_logs" {
  description = "Secret Manager・Cloud KMS・Cloud Storage のデータアクセス監査ログ(DATA_READ / DATA_WRITE。シークレットの値の読み取り、鍵の encrypt / decrypt、領収書の画像・ビルドのオブジェクトの読み書きが「誰が・いつ」で残る)を有効にするか。ログの量に応じて Cloud Logging の課金が増える(月 50 GiB までは無料枠。この規模ではわずか)ため、切れるようにしてある"
  type        = bool
  default     = true
}
