/**
 * ファイル保存のポート。領収書画像・顧客カルテの写真が対象。
 * 正の保存先はオブジェクトストレージ(ローカルはファイルシステム、本番はGCS)で、
 * Google Drive へは互換維持のためのミラーとして書く。
 */
export interface StoredFile {
  /** 保存先を一意に指す内部キー。DBにはこれを保存する。 */
  key: string;
  contentType: string;
  byteSize: number;
}

export interface StoragePort {
  put(key: string, contentType: string, body: Uint8Array): Promise<StoredFile>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  /** 期限付きの閲覧URL。ローカル実装はAPI経由の配信URLを返す。 */
  signedUrl(key: string, expiresInSec: number): Promise<string>;
}
