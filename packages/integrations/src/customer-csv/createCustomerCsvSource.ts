import type { CustomerCsvSourcePort } from '@katahimo/core/ports';
import { GoogleDriveCustomerCsvSource } from './googleDriveCustomerCsvSource';
import { LocalDirectoryCustomerCsvSource } from './localDirectoryCustomerCsvSource';

export interface CustomerCsvSourceConfig {
  /** テナントslug → DriveフォルダID。1件以上あればGoogle Driveを取込元にする。 */
  driveFolderIdsByTenantSlug?: Readonly<Record<string, string>>;
  /** ローカル開発用: `<dir>/<テナントslug>/` を取込元にする(Driveの設定が無い場合のみ)。 */
  localDir?: string;
}

/** どのテナントにも取込元が無い(自動取込を使わない)場合の実装。 */
class UnconfiguredCustomerCsvSource implements CustomerCsvSourcePort {
  async listFiles(): Promise<null> {
    return null;
  }
  async readFile(): Promise<Buffer> {
    throw new Error('顧客CSVの取込元が設定されていません');
  }
}

/** 環境設定から顧客CSVの取込元を選ぶ(Drive > ローカルディレクトリ > 取込なし)。API・ワーカー共通。 */
export function createCustomerCsvSource(config: CustomerCsvSourceConfig): CustomerCsvSourcePort {
  const folders = config.driveFolderIdsByTenantSlug ?? {};
  if (Object.keys(folders).length > 0) {
    return new GoogleDriveCustomerCsvSource({ folderIdsByTenantSlug: folders });
  }
  if (config.localDir) return new LocalDirectoryCustomerCsvSource(config.localDir);
  return new UnconfiguredCustomerCsvSource();
}

/**
 * 環境変数 CUSTOMER_CSV_DRIVE_FOLDERS(JSON: {"テナントslug": "DriveフォルダID"})を読む。
 * 未設定・空なら空のマップ。形式が不正なら起動時に気づけるよう例外にする。
 */
export function parseTenantFolderMap(json: string | undefined): Record<string, string> {
  if (!json || json.trim() === '') return {};
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('CUSTOMER_CSV_DRIVE_FOLDERS は {"テナントslug": "フォルダID"} 形式のJSONにしてください');
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.some(([, v]) => typeof v !== 'string' || v === '')) {
    throw new Error('CUSTOMER_CSV_DRIVE_FOLDERS のフォルダIDは空でない文字列にしてください');
  }
  return Object.fromEntries(entries) as Record<string, string>;
}
