import type { CustomerCsvSourceFile } from '@katahimo/core/ports';
import type { drive_v3 } from 'googleapis';

const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

/** Driveの検索クエリに埋め込む文字列リテラルのエスケープ(GAS版 escapeForDriveQuery_ と同じ)。 */
function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** 顧客CSVを置く Drive のフォルダの読み出し(テスト用に差し替えられるよう、取込元の選択とは分ける)。 */
export interface CustomerCsvDriveFolderReader {
  listFiles(folderId: string): Promise<CustomerCsvSourceFile[]>;
  readFile(fileId: string): Promise<Buffer>;
}

/**
 * Google Drive のフォルダから顧客CSVを読む。認証はアプリケーションのデフォルト認証情報
 * (Cloud Run のサービスアカウント、ローカルは GOOGLE_APPLICATION_CREDENTIALS のサービスアカウントJSON)。
 * 対象フォルダをそのサービスアカウントに閲覧者として共有しておく必要がある。
 * フォルダID はテナントの取込元の設定(platform.tenants.customer_import_settings)から渡される。
 */
export class GoogleDriveCustomerCsvFolder implements CustomerCsvDriveFolderReader {
  /** googleapis は読み込みが重いため、最初の呼び出しまで import を遅らせる(起動時間を延ばさない)。 */
  private drivePromise: Promise<drive_v3.Drive> | null = null;

  private drive(): Promise<drive_v3.Drive> {
    this.drivePromise ??= import('googleapis').then(({ google }) =>
      google.drive({ version: 'v3', auth: new google.auth.GoogleAuth({ scopes: [DRIVE_READONLY_SCOPE] }) }),
    );
    return this.drivePromise;
  }

  async listFiles(folderId: string): Promise<CustomerCsvSourceFile[]> {
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

  async readFile(fileId: string): Promise<Buffer> {
    const res = await (await this.drive()).files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }
}
