import type { LegacyImportRowSource } from '../domain/model';

/**
 * GAS版のスプレッドシート・Drive からの移行の取込(日報・事故報告・領収書)のポート。読むだけ(GAS版の
 * スプレッドシート・Drive には何も書かない)。実装は Google Sheets API / Drive API(integrations/src/legacy-sheets)。
 */

/** セルの値。 */
export interface LegacySheetCell {
  /**
   * 書式を付けない値。日時・時刻のセルはシリアル値(1899-12-30 からの日数。小数部が時刻)の数値、数字だけを入れた
   * セルは数値になる。空のセルは null。
   */
  value: string | number | boolean | null;
  /** シートに表示されている文字列(表示形式を付けたもの。空のセルは '')。 */
  text: string;
}

export interface LegacySheet {
  /** シートの名前。 */
  title: string;
  /** 1行目(見出し)から最後の行まで。rows[i] はシートの i + 1 行目。行の末尾の空のセルは省かれることがある。 */
  rows: LegacySheetCell[][];
}

export interface LegacySpreadsheetPort {
  /**
   * シートの全ての行を読む。sheetName が null なら先頭のシート(GAS版の「領収書一覧」は getSheets()[0] に書いていた)。
   * スプレッドシート・シートが無い・読めない(共有されていない)ときは例外。
   */
  readSheet(spreadsheetId: string, sheetName: string | null): Promise<LegacySheet>;
}

/** Drive のファイルのメタデータ。 */
export interface LegacyDriveFile {
  id: string;
  mimeType: string;
  /** バイト数(Drive が返さなければ null)。 */
  byteSize: number | null;
  trashed: boolean;
}

export interface LegacyDriveFilePort {
  /** ファイルのメタデータ。無い・読めない(共有されていない)ときは null。 */
  getFile(fileId: string): Promise<LegacyDriveFile | null>;
  /** ファイルの中身。読めないときは例外。 */
  download(fileId: string): Promise<Uint8Array>;
}

/** 取り込んだ行と、取り込んだ先の記録(日報・事故報告は care_records、領収書は receipts)の対応。 */
export interface LegacyImportedRow {
  source: LegacyImportRowSource;
  /** 出どころの行を指すキー(ingestion の legacySheets が作る。行番号・本文は入れない)。 */
  sourceKey: string;
  careRecordId: string | null;
  receiptId: string | null;
  /** 取り込んだときの行の内容の SHA-256(次の取込で、シートの行が直されたかを見る)。 */
  sourceDigest: Uint8Array;
  /** 取込が書いた後の記録の row_version(これと違えば、取込の後に本アプリで直された)。 */
  syncedRowVersion: number;
}

export interface LegacyImportRepository {
  /**
   * このテナントの GAS版からの取込をトランザクションの終わりまで1つずつにする(テナントごとのアドバイザリロック)。
   * 同時に2つ流しても、キーで突き合わせてから作る間に同じ行を2回作らない。取込の書き込みの最初に呼ぶ。
   */
  lockTenantLegacyImports(): Promise<void>;
  /** キーで対応を探す(見つかったものだけ)。 */
  findBySourceKeys(
    source: LegacyImportRowSource,
    sourceKeys: readonly string[],
  ): Promise<LegacyImportedRow[]>;
  /** その出どころから取り込んだ全ての対応(シートから消えた行を見つける)。 */
  listBySource(source: LegacyImportRowSource): Promise<LegacyImportedRow[]>;
  /** 対応を書く(同じキーがあれば内容の SHA-256・版・取込の実行を置き換える)。 */
  save(row: LegacyImportedRow & { importRunId: string }): Promise<void>;
  /** その領収書が GAS版から取り込んだものか。 */
  isImportedReceipt(receiptId: string): Promise<boolean>;
}
