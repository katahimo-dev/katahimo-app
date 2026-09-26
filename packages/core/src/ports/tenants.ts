import type { BusinessType, TenantStatus } from '../domain/model';

export interface TenantRecord {
  id: string;
  slug: string;
  name: string;
  /** active 以外はログイン・API・ジョブの対象外。 */
  status: TenantStatus;
  /** 業務日の境界・壁時計時刻の解釈に使う IANA タイムゾーン。 */
  timezone: string;
  businessType: BusinessType;
}

/** platform.tenants の参照(RLS なし。ログイン前のテナント特定・ジョブのテナント一覧)。 */
export interface TenantDirectoryPort {
  findBySlug(slug: string): Promise<TenantRecord | null>;
  findById(id: string): Promise<TenantRecord | null>;
  /** status = 'active' のテナント(夜間ジョブ・CSV取込の対象)。 */
  listActive(): Promise<TenantRecord[]>;
  /** 消去(platform.purge_tenant)されていない全てのテナント(停止中・解約済みを含む。保守ジョブの対象)。 */
  listAll(): Promise<TenantRecord[]>;
}

export interface ProvisionTenantInput {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  businessType: BusinessType;
}

/** テナントの作成(platform.provision_tenant()。運用の CLI・シードだけが使う)。 */
export interface TenantProvisioningPort {
  provision(input: ProvisionTenantInput): Promise<void>;
}
