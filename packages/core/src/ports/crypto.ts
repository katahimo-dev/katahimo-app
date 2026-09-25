/**
 * 個人情報の暗号化・検索用のポート(実装は @katahimo/integrations の LocalCryptoPort / LocalBlindIndexPort)。
 *
 * - 値は AES-256-GCM(値ごとにランダムな nonce)で暗号化し、bytea(*_enc)に保存する。暗号文の先頭に
 *   形式の版・DEK の版・nonce を書く(自己記述。DEK をローテーションしても古い暗号文を読める)。
 * - AAD(追加認証データ)にテナントID・用途(`テーブル.列`)・行ID を含め、暗号文を別のテナント・列・行へ
 *   写すと復号に失敗する(改ざんとして検出)。ID はアプリが INSERT 前に採番するため、行IDも結び付けられる。
 *   履歴(entity_changes.before_enc)に写す値は、履歴の用途・履歴の行IDで暗号化し直す。
 * - 鍵(DEK)はテナントごと・版ごとにランダムに作り、KEK(Cloud KMS)でラップした値だけを DB に置く
 *   (tenant_data_keys。エンベロープ暗号化)。
 * - 等値検索が要る値はブラインドインデックス(テナント・用途ごとの鍵の HMAC)を別に持つ。
 */

/** 暗号文の用途(`テーブル.列`)。書き込みと読み出しで同じ値を使う(domain/pii/encryptionPurposes.ts)。 */
export type EncryptionPurpose = `${string}.${string}`;

export interface CipherContext {
  tenantId: string;
  purpose: EncryptionPurpose;
  /** 暗号文を置く行のID(主キーが (tenant_id, id) でない表は自然キー)。 */
  rowId: string;
}

export interface CryptoPort {
  encrypt(context: CipherContext, plaintext: string): Promise<Uint8Array>;
  decrypt(context: CipherContext, ciphertext: Uint8Array): Promise<string>;
  /**
   * テナントの鍵を使える状態にしておく(鍵の読み込み・KMS でのアンラップ)。Unit of Work はトランザクションを
   * 開く前に呼ぶ: トランザクションの中で鍵の読み込み(別の接続)や KMS の呼び出し(ネットワーク)を待たないため。
   */
  prepare(tenantId: string): Promise<void>;
}

/** ブラインドインデックスの用途(鍵を用途ごとに分ける)。 */
export type BlindIndexPurpose = 'receipts.dedupe';

export interface BlindIndexPort {
  /**
   * 正規化済みの値のブラインドインデックス(先頭1バイトが鍵の版)。呼び出し側は必ず正規化してから渡す
   * (domain/pii/normalize.ts。正規化がずれると同じ値でも一致しない)。
   */
  compute(tenantId: string, purpose: BlindIndexPurpose, normalizedValue: string): Promise<Uint8Array>;
}

/**
 * 復号の監査。値ごとではなく操作ごとに1件(何件復号したか)を記録する(顧客詳細の表示・予定のマスタの
 * 読み込み等)。実装は1行の構造化ログ(Cloud Logging)。
 */
export interface DecryptAuditEntry {
  tenantId: string;
  /** 操作の名前(例: 'customer.detail'、'schedule.directory')。 */
  operation: string;
  count: number;
  actorStaffId?: string | null;
}

export interface AuditLogPort {
  recordDecrypt(entry: DecryptAuditEntry): void;
}
