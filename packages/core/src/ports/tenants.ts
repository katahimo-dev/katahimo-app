import type { BusinessType, DataKeyState, TenantStatus } from '../domain/model';

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
  /** status = 'active' のテナント(夜間ジョブ・CSV取込・outbox の対象)。 */
  listActive(): Promise<TenantRecord[]>;
}

export interface ProvisionTenantInput {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  businessType: BusinessType;
  wrappedDek: Uint8Array;
  kekKeyName: string;
}

/** テナントの作成(platform.provision_tenant()。運用の CLI・シードだけが使う)。 */
export interface TenantProvisioningPort {
  provision(input: ProvisionTenantInput): Promise<void>;
}

export interface TenantDataKeyRecord {
  version: number;
  wrappedDek: Uint8Array;
  kekKeyName: string;
  state: Exclude<DataKeyState, 'destroyed'>;
}

/** 復号に使える DEK(active / decrypt_only)の読み出し(CryptoPort 実装が使う。テナントの RLS の中で読む)。 */
export interface TenantDataKeyReaderPort {
  listUsable(tenantId: string): Promise<TenantDataKeyRecord[]>;
}
