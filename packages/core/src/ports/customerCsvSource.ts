import type { TenantCustomerImportSettings } from '../domain/customerCsv/importSettings';

/**
 * 顧客CSV(RESERVAの顧客エクスポート)の取込元。GAS版は CUSTOMER_CSV_FOLDER_ID の
 * Driveフォルダを見ていた(CsvImport.js)。本番はテナントごとの Google Drive のフォルダ(運用担当者が
 * platform.tenants.customer_import_settings に設定する)、ローカル開発はディレクトリ。
 * どのファイルを取り込むか(命名規則・最新の判定)は domain/customerCsv が決める。
 */

export interface CustomerCsvSourceTenant {
  id: string;
  slug: string;
}

/** 取込元を探す手がかり(テナントと、そのテナントの取込元の設定)。 */
export interface CustomerCsvLocation {
  tenant: CustomerCsvSourceTenant;
  /** platform.tenants.customer_import_settings(設定の無いテナントは null)。 */
  settings: TenantCustomerImportSettings | null;
}

export interface CustomerCsvSourceFile {
  /** 取込元内での識別子(DriveのファイルID、ローカルはファイルパス)。 */
  id: string;
  name: string;
}

export interface CustomerCsvSourcePort {
  /**
   * テナントの取込元にあるファイル一覧。このテナントの取込元が設定されていなければnull
   * (自動取込の対象外として扱う)。
   */
  listFiles(location: CustomerCsvLocation): Promise<CustomerCsvSourceFile[] | null>;
  readFile(location: CustomerCsvLocation, file: CustomerCsvSourceFile): Promise<Buffer>;
}
