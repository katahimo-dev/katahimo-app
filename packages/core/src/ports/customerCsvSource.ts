/**
 * 顧客CSV(RESERVAの顧客エクスポート)の取込元。GAS版は CUSTOMER_CSV_FOLDER_ID の
 * Driveフォルダを見ていた(CsvImport.js)。本番はGoogle Drive、ローカル開発はディレクトリ。
 * どのファイルを取り込むか(命名規則・最新の判定)は domain/customerCsv が決める。
 */

export interface CustomerCsvSourceTenant {
  id: string;
  slug: string;
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
  listFiles(tenant: CustomerCsvSourceTenant): Promise<CustomerCsvSourceFile[] | null>;
  readFile(tenant: CustomerCsvSourceTenant, file: CustomerCsvSourceFile): Promise<Buffer>;
}
