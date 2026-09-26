import type { CustomerCsvLocation, CustomerCsvSourceFile, CustomerCsvSourcePort } from '@katahimo/core/ports';
import {
  type CustomerCsvDriveFolderReader,
  GoogleDriveCustomerCsvFolder,
} from './googleDriveCustomerCsvSource';
import { LocalDirectoryCustomerCsvSource } from './localDirectoryCustomerCsvSource';

export interface CustomerCsvSourceConfig {
  /**
   * ローカル開発用(CUSTOMER_CSV_LOCAL_DIR): 取込元の設定の無いテナントは `<dir>/<テナントslug>/` を取込元にする。
   */
  localDir?: string;
}

/**
 * テナントの取込元の設定で取込元を選ぶ: 設定(customer_import_settings)があればその Drive のフォルダ、
 * 無ければローカルディレクトリ(CUSTOMER_CSV_LOCAL_DIR がある時だけ)、どちらも無ければ取込元なし(null)。
 */
export class TenantCustomerCsvSource implements CustomerCsvSourcePort {
  private readonly local: LocalDirectoryCustomerCsvSource | null;

  constructor(
    private readonly drive: CustomerCsvDriveFolderReader,
    localDir?: string,
  ) {
    this.local = localDir ? new LocalDirectoryCustomerCsvSource(localDir) : null;
  }

  async listFiles(location: CustomerCsvLocation): Promise<CustomerCsvSourceFile[] | null> {
    if (location.settings) return this.drive.listFiles(location.settings.driveFolderId);
    return this.local ? this.local.listFiles(location.tenant) : null;
  }

  async readFile(location: CustomerCsvLocation, file: CustomerCsvSourceFile): Promise<Buffer> {
    if (location.settings) return this.drive.readFile(file.id);
    if (!this.local) throw new Error('顧客CSVの取込元が設定されていません');
    return this.local.readFile(location.tenant, file);
  }
}

/** 顧客CSVの取込元(API の手動取込・ワーカーの定期取込で共通)。 */
export function createCustomerCsvSource(config: CustomerCsvSourceConfig): CustomerCsvSourcePort {
  return new TenantCustomerCsvSource(new GoogleDriveCustomerCsvFolder(), config.localDir);
}
