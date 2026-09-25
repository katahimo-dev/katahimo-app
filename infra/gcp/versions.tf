# katahimo-app の GCP 本番環境(doc/11_GCPデプロイ手順.md)。
# state には秘密の値を入れない方針(Secret Manager は「入れ物」だけを作り、値は gcloud で登録する)。
# それでも state にはインスタンス名・SA 等の構成情報が入るため、アクセスを絞った GCS バケットに置く。

terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.0"
    }
  }

  # 初回は `terraform init -backend-config="bucket=<state用バケット>"` で指定する(doc/11 「2.」)。
  backend "gcs" {
    prefix = "katahimo/prod"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
