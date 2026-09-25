/**
 * KEK(Key Encryption Key)によるDEKのラップ/アンラップを行うポート。
 *
 * CryptoPort(./crypto.ts)が使う「テナントごとのDEK」は平文のまま保存せず、必ずこのポートで
 * ラップした状態(TenantKeyRepositoryPortのwrappedDek列)だけを永続化する。
 *
 * ローカル開発実装(@katahimo/integrations の LocalKmsPort)は環境変数1本のKEKでAES-256-GCM
 * ラップを行う簡易実装。本番はCloud KMSの `CryptoKeyVersion` をKEKとして使う実装に差し替える
 * (Phase 5、実際のGCPプロジェクト・KMSキーリングが用意でき次第)。差し替えの際、このポートの
 * インターフェース自体は変えずに済む設計にしてある(呼び出し側はwrap/unwrapの実装詳細を知らない)。
 */

export interface WrappedDek {
  /** Base64エンコードされたラップ済みDEK(ローカル実装はnonce+authTag+ciphertext、KMS実装はKMSのAPIレスポンスをそのまま格納)。 */
  ciphertext: string;
  /** ラップに使ったKEKのバージョン。KEKローテーション時、旧バージョンでラップされたDEKを新KEKで再ラップするために必要。 */
  kekVersion: number;
}

export interface KeyManagementPort {
  /** 現在有効なKEKのバージョン。新規にDEKをラップする際に使う。 */
  readonly currentKekVersion: number;
  wrap(dek: Buffer): Promise<WrappedDek>;
  /** kekVersionが古い場合も含め、指定バージョンのKEKでアンラップできる必要がある。 */
  unwrap(wrapped: WrappedDek): Promise<Buffer>;
}
