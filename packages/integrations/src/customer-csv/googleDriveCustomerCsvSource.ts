import type {
  CustomerCsvSourceFile,
  CustomerCsvSourcePort,
  CustomerCsvSourceTenant,
} from '@katahimo/core/ports';
import type { drive_v3 } from 'googleapis';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

export interface GoogleDriveCustomerCsvSourceOptions {
  /** テナントslug → 顧客CSVが置かれるDriveフォルダID(GAS版 Config.js の CUSTOMER_CSV_FOLDER_ID)。 */
  folderIdsByTenantSlug: Readonly<Record<string, string>>;
}

/** Driveの検索クエリに埋め込む文字列リテラルのエスケープ(GAS版 escapeForDriveQuery_ と同じ)。 */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Google Drive のフォルダから顧客CSVを読む取込元。認証はアプリケーションのデフォルト認証情報
 * (Cloud Run のサービスアカウント、ローカルは GOOGLE_APPLICATION_CREDENTIALS のサービスアカウントJSON)。
 * 対象フォルダをそのサービスアカウントに閲覧者として共有しておく必要がある。
 */
export class GoogleDriveCustomerCsvSource implements CustomerCsvSourcePort {
  /** googleapis は読み込みが重いため、最初の呼び出しまで import を遅らせる(起動時間を延ばさない)。 */
  private drivePromise: Promise<drive_v3.Drive> | null = null;

  constructor(private readonly options: GoogleDriveCustomerCsvSourceOptions) {}

  private drive(): Promise<drive_v3.Drive> {
    this.drivePromise ??= import('googleapis').then(({ google }) =>
      google.drive({ version: 'v3', auth: new google.auth.GoogleAuth({ scopes: [DRIVE_READONLY_SCOPE] }) }),
    );
    return this.drivePromise;
  }

  async listFiles(tenant: CustomerCsvSourceTenant): Promise<CustomerCsvSourceFile[] | null> {
    const folderId = this.options.folderIdsByTenantSlug[tenant.slug];
    if (!folderId) return null;

    const drive = await this.drive();
    const files: CustomerCsvSourceFile[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed = false and name contains 'Kokyaku_'`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const file of res.data.files ?? []) {
        if (file.id && file.name) files.push({ id: file.id, name: file.name });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return files;
  }

  async readFile(_tenant: CustomerCsvSourceTenant, file: CustomerCsvSourceFile): Promise<Buffer> {
    const res = await (await this.drive()).files.get(
      { fileId: file.id, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }
}
