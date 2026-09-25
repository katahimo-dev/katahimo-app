/**
 * KEK(Key Encryption Key)による DEK のラップ/アンラップ(実装は @katahimo/integrations の
 * LocalKmsPort(開発)/ CloudKmsPort(本番))。平文の DEK は CryptoPort 実装のプロセス内メモリにしか置かない。
 */
export interface WrappedDek {
  wrapped: Uint8Array;
  /** ラップに使った KEK の名前(tenant_data_keys.kek_key_name)。 */
  kekKeyName: string;
}

export interface KeyManagementPort {
  /** tenantId は AAD としてラップに結び付ける(別テナントの行に写してもアンラップできない)。 */
  wrap(dek: Uint8Array, tenantId: string): Promise<WrappedDek>;
  unwrap(wrapped: WrappedDek, tenantId: string): Promise<Uint8Array>;
}
