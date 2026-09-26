# katahimo-app の GCP 本番環境(doc/07_インフラ・運用.md)。
# state には秘密の値を入れない方針(Secret Manager は「入れ物」だけを作り、値は gcloud で登録する)。
# それでも state にはインスタンス名・SA 等の構成情報が入るため、アクセスを絞った GCS バケットに置く。

terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
    # Cloud SQL のサービスエージェントの作成(google_project_service_identity。kms.tf)だけに使う
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.0"
    }
    # 鍵の権限が広まるまでの待ち(time_sleep。kms.tf)だけに使う
    time = {
      source  = "hashicorp/time"
      version = "~> 0.14"
    }
  }

  # 初回は `terraform init -backend-config="bucket=<state用バケット>"` で指定する(doc/07_インフラ・運用.md 3章)。
  backend "gcs" {
    prefix = "katahimo/prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}
