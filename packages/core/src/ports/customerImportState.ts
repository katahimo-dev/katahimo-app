/**
 * 顧客CSV取込の状態(app_settings の customer_csv_last_imported_version / data_version)。
 * GAS版 Script Properties の LATEST_CSV_VERSION / DATA_VERSION に相当する。
 */
export interface CustomerImportState {
  /** 最後に取り込んだCSVの版(ファイル名の YYYYMMDDHHmm)。未取込ならnull。 */
  lastImportedVersion: string | null;
  lastImportedAt: Date | null;
  /** 顧客データが取込で更新されるたびに+1する版数。クライアントのキャッシュ無効化判定に使う。 */
  dataVersion: number;
}

export interface CustomerImportStateRepositoryPort {
  get(tenantId: string): Promise<CustomerImportState>;
  /** 取込成功を記録する(版・取込日時を更新し、dataVersion を+1する)。 */
  recordImport(tenantId: string, version: string, importedAt: Date): Promise<CustomerImportState>;
}
