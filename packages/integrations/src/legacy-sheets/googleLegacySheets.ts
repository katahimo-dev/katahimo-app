import type {
  LegacyDriveFile,
  LegacyDriveFilePort,
  LegacySheet,
  LegacySheetCell,
  LegacySpreadsheetPort,
} from '@katahimo/core/ports';
import type { drive_v3, sheets_v4 } from 'googleapis';

/** 読むだけのスコープ(サービスアカウント・ADC の成り代わり。ユーザーの ADC はログインのときのスコープが効く)。 */
export const LEGACY_SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const;

/** 1回に読む行の数(大きなシートを分けて読む)。 */
export const LEGACY_SHEET_ROWS_PER_REQUEST = 2000;

/** Sheets API のうち取込が使うもの(テストで差し替える)。 */
export interface LegacySheetsApi {
  /** シートの名前と行数(先頭のシートから順に)。 */
  listSheets(spreadsheetId: string): Promise<{ title: string; rowCount: number }[]>;
  /** 範囲の値。render は表示の文字列(FORMATTED_VALUE)か書式を付けない値(UNFORMATTED_VALUE・日時はシリアル値)。 */
  getValues(spreadsheetId: string, range: string, render: 'formatted' | 'unformatted'): Promise<unknown[][]>;
}

/** Drive API のうち取込が使うもの(テストで差し替える)。 */
export interface LegacyDriveApi {
  getFile(fileId: string): Promise<{
    id?: string | null;
    mimeType?: string | null;
    size?: string | null;
    trashed?: boolean | null;
  }>;
  download(fileId: string): Promise<ArrayBuffer>;
}

/** Google の API の HTTP の状態(googleapis の GaxiosError)。 */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown; response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : null;
}

/** A1 表記のシート名('' で囲み、中の ' は2つ重ねる)。 */
export function quoteSheetName(title: string): string {
  return `'${title.replaceAll("'", "''")}'`;
}

function cellValueOf(raw: unknown): LegacySheetCell['value'] {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return raw;
  return String(raw);
}

/**
 * GAS版のスプレッドシートを Sheets API で読む(移行の取込)。表示の文字列と書式を付けない値の2回読み、セルごとに
 * 合わせる(自由記述・氏名は表示のとおり、日時・時刻・評価・金額・ID は値で読むため)。
 */
export class GoogleLegacySpreadsheetReader implements LegacySpreadsheetPort {
  constructor(private readonly api: LegacySheetsApi) {}

  async readSheet(spreadsheetId: string, sheetName: string | null): Promise<LegacySheet> {
    let sheets: { title: string; rowCount: number }[];
    try {
      sheets = await this.api.listSheets(spreadsheetId);
    } catch (error) {
      const status = statusOf(error);
      throw new Error(
        `スプレッドシートを読めません(${status === null ? 'Google の認証情報(ADC)が無い等' : `HTTP ${status}`})。` +
          'スプレッドシートの ID と、読む Google アカウント(サービスアカウント、またはログインした人)への共有を確かめてください',
        { cause: error },
      );
    }
    const sheet = sheetName === null ? sheets[0] : sheets.find((s) => s.title === sheetName);
    if (!sheet) {
      throw new Error(
        sheetName === null ? 'スプレッドシートにシートがありません' : `シート「${sheetName}」がありません`,
      );
    }
    const rows: LegacySheetCell[][] = [];
    for (let start = 1; start <= sheet.rowCount; start += LEGACY_SHEET_ROWS_PER_REQUEST) {
      const end = Math.min(sheet.rowCount, start + LEGACY_SHEET_ROWS_PER_REQUEST - 1);
      const range = `${quoteSheetName(sheet.title)}!${start}:${end}`;
      const [texts, values] = await Promise.all([
        this.api.getValues(spreadsheetId, range, 'formatted'),
        this.api.getValues(spreadsheetId, range, 'unformatted'),
      ]);
      // 範囲の後ろの空の行は返らない(途中の空の行は空の配列で返る)。値のある範囲の前は、行番号がずれないように埋める
      const count = Math.max(texts.length, values.length);
      if (count > 0 && rows.length < start - 1) {
        rows.push(...Array.from({ length: start - 1 - rows.length }, () => []));
      }
      for (let i = 0; i < count; i++) {
        const textRow = texts[i] ?? [];
        const valueRow = values[i] ?? [];
        const width = Math.max(textRow.length, valueRow.length);
        rows.push(
          Array.from({ length: width }, (_, c) => ({
            value: cellValueOf(valueRow[c]),
            text: textRow[c] === undefined || textRow[c] === null ? '' : String(textRow[c]),
          })),
        );
      }
    }
    return { title: sheet.title, rows };
  }
}

/** 領収書の画像を Drive API で読む(移行の取込)。 */
export class GoogleLegacyDriveFiles implements LegacyDriveFilePort {
  constructor(private readonly api: LegacyDriveApi) {}

  async getFile(fileId: string): Promise<LegacyDriveFile | null> {
    try {
      const file = await this.api.getFile(fileId);
      const size = file.size === undefined || file.size === null ? null : Number(file.size);
      return {
        id: file.id ?? fileId,
        mimeType: file.mimeType ?? '',
        byteSize: size !== null && Number.isFinite(size) ? size : null,
        trashed: file.trashed === true,
      };
    } catch (error) {
      // 無い・共有されていないファイルは「読めない画像」として行ごとに扱う
      const status = statusOf(error);
      if (status === 403 || status === 404) return null;
      throw error;
    }
  }

  async download(fileId: string): Promise<Uint8Array> {
    return new Uint8Array(await this.api.download(fileId));
  }
}

/**
 * Application Default Credentials で Sheets API・Drive API を読むクライアント。本番・サービスアカウントは
 * GOOGLE_APPLICATION_CREDENTIALS(キー)か `gcloud auth application-default login --impersonate-service-account`、
 * 運用担当者本人の Google アカウントは `gcloud auth application-default login --scopes=…`(ユーザーの ADC。
 * 課金・割り当ての プロジェクトは ADC の quota_project_id か GOOGLE_CLOUD_QUOTA_PROJECT)。googleapis は読み込みが
 * 重いため、最初の呼び出しまで import を遅らせる。
 */
export function createLegacySheetsReaders(): { sheets: LegacySpreadsheetPort; drive: LegacyDriveFilePort } {
  let clients: Promise<{ sheets: sheets_v4.Sheets; drive: drive_v3.Drive }> | null = null;
  const connect = () => {
    clients ??= import('googleapis').then(({ google }) => {
      const auth = new google.auth.GoogleAuth({ scopes: [...LEGACY_SHEETS_SCOPES] });
      return { sheets: google.sheets({ version: 'v4', auth }), drive: google.drive({ version: 'v3', auth }) };
    });
    return clients;
  };
  const sheetsApi: LegacySheetsApi = {
    async listSheets(spreadsheetId) {
      const res = await (await connect()).sheets.spreadsheets.get({
        spreadsheetId,
        fields: 'sheets.properties(title,index,gridProperties.rowCount)',
      });
      return (res.data.sheets ?? [])
        .map((s) => s.properties ?? {})
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((p) => ({ title: p.title ?? '', rowCount: p.gridProperties?.rowCount ?? 0 }));
    },
    async getValues(spreadsheetId, range, render) {
      const res = await (await connect()).sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        majorDimension: 'ROWS',
        valueRenderOption: render === 'formatted' ? 'FORMATTED_VALUE' : 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'SERIAL_NUMBER',
      });
      return (res.data.values ?? []) as unknown[][];
    },
  };
  const driveApi: LegacyDriveApi = {
    async getFile(fileId) {
      const res = await (await connect()).drive.files.get({
        fileId,
        fields: 'id, mimeType, size, trashed',
        supportsAllDrives: true,
      });
      return res.data;
    },
    async download(fileId) {
      const res = await (await connect()).drive.files.get(
        { fileId, alt: 'media', supportsAllDrives: true },
        { responseType: 'arraybuffer' },
      );
      return res.data as unknown as ArrayBuffer;
    },
  };
  return {
    sheets: new GoogleLegacySpreadsheetReader(sheetsApi),
    drive: new GoogleLegacyDriveFiles(driveApi),
  };
}
