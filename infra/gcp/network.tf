# VPC(Cloud SQL をプライベート IP だけにするため。doc/07_インフラ・運用.md 2.1)。
# - Cloud SQL はプライベート サービス アクセス(VPC ピアリング)の範囲に置き、パブリック IP を持たない(sql.tf)。
# - Cloud Run(API・ジョブ)は Direct VPC egress でこの VPC のサブネットから出る。VPC へ出すのはプライベートの宛先だけ
#   (PRIVATE_RANGES_ONLY)で、Google の API・外部サービス(Gemini・Maps・SMTP 等)へはこれまでどおり直接出る。
# - DB へは Cloud SQL の言語コネクタでつなぐ(IAM の cloudsql.client で認可し、証明書を確かめた TLS。CLOUD_SQL_IP_TYPE=PRIVATE。
#   packages/db/src/cloudSqlConnector.ts)。VPC には Cloud Run 以外の機械を置かない(手元からの運用は ops ジョブ。run.tf)。
# - 範囲は他のネットワークとつながないため、プライベートの範囲なら何でもよい。変えるとサブネット・ピアリングの作り直しになる。

resource "google_compute_network" "main" {
  name                    = "katahimo-vpc"
  auto_create_subnetworks = false

  depends_on = [google_project_service.enabled]
}

# Cloud Run の Direct VPC egress が IP を取るサブネット(インスタンス・ジョブの実行ごとに使う。/24 で約250。
# API の最大インスタンス数 × 2 とジョブの同時実行が収まる大きさにする)
resource "google_compute_subnetwork" "run" {
  name          = "katahimo-run"
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = var.vpc_run_subnet_cidr
  # Google の API へ VPC から出る場合に備える(既定の PRIVATE_RANGES_ONLY では使わない)
  private_ip_google_access = true
}

# Cloud SQL のプライベート IP を取る範囲(プライベート サービス アクセス)
resource "google_compute_global_address" "private_services" {
  name          = "katahimo-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  address       = split("/", var.vpc_private_services_cidr)[0]
  prefix_length = tonumber(split("/", var.vpc_private_services_cidr)[1])
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}
