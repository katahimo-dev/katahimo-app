import type { TenantCustomerImportSettings } from '../domain/customerCsv/importSettings';
import type { BusinessType, TenantStatus } from '../domain/model';
import type { TenantCalendarSettings } from '../domain/schedule/calendarPolicy';

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

/**
 * テナントのカレンダーの設定の読み書き(運用担当者の CLI だけが使う。platform.tenants は所有者しか書けないため
 * MIGRATION_DATABASE_URL の接続で使う)。
 */
export interface TenantCalendarSettingsStore {
  get(tenantId: string): Promise<TenantCalendarSettings>;
  set(tenantId: string, settings: TenantCalendarSettings): Promise<void>;
}

/**
 * テナントの顧客データの取込元の設定の読み書き(運用担当者の CLI `pnpm tenant:customer-source` だけが使う。
 * MIGRATION_DATABASE_URL の接続で使う)。null は未設定(自動取込の対象外)。
 */
export interface TenantCustomerImportSettingsStore {
  get(tenantId: string): Promise<TenantCustomerImportSettings | null>;
  /** この Drive のフォルダを取込元にしているテナントの ID(完全一致)。 */
  findTenantIdsByDriveFolder(driveFolderId: string): Promise<string[]>;
  set(tenantId: string, settings: TenantCustomerImportSettings | null): Promise<void>;
}
