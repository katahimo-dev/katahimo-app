import type { KeyManagementPort, WrappedDek } from '@katahimo/core/ports';
import { dekWrapAad } from '../local-kms/dekWrapAad';

/** CloudKmsPort が使う Cloud KMS の暗号化/復号(Base64 の入出力)。本番は cloudKmsApiClient.ts。 */
export interface CloudKmsClient {
  /** aadBase64 は Cloud KMS の additionalAuthenticatedData(復号時にも同じ値が必要)。 */
  encrypt(keyName: string, plaintextBase64: string, aadBase64: string): Promise<string>;
  decrypt(keyName: string, ciphertextBase64: string, aadBase64: string): Promise<string>;
}

export interface CloudKmsPortOptions {
  /** `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>`(対称鍵 ENCRYPT_DECRYPT)。 */
  keyName: string;
  client: CloudKmsClient;
}

const KEY_NAME_PATTERN = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/;

/**
 * KeyManagementPort の Cloud KMS 実装。テナントDEKを Cloud KMS の対称鍵(KEK)で encrypt/decrypt する。
 *
 * - KEK の鍵マテリアルはKMSの外に出ない。鍵のローテーション(新しい CryptoKeyVersion)はKMS側で行い、KMS の
 *   暗号文に使った版が含まれるため旧版を無効化しない限り既存のDEKも復号できる。
 * - tenant_data_keys.kek_key_name には鍵名を保存し、別の鍵でラップされた DEK は復号しない。
 * - ラップにはテナントIDを追加認証データ(additionalAuthenticatedData)として結び付ける。
 * - DEK のアンラップ結果は LocalCryptoPort がプロセス内にキャッシュするため、KMS 呼び出しはインスタンスの
 *   起動後のテナント・版ごとの初回だけ。
 */
export class CloudKmsPort implements KeyManagementPort {
  constructor(private readonly options: CloudKmsPortOptions) {
    if (!KEY_NAME_PATTERN.test(options.keyName)) {
      throw new Error(
        `KMS の鍵名が不正です: ${options.keyName}(projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k> の形式)`,
      );
    }
  }

  async wrap(dek: Uint8Array, tenantId: string): Promise<WrappedDek> {
    const ciphertext = await this.options.client.encrypt(
      this.options.keyName,
      Buffer.from(dek).toString('base64'),
      dekWrapAad(tenantId).toString('base64'),
    );
    return { wrapped: Buffer.from(ciphertext, 'base64'), kekKeyName: this.options.keyName };
  }

  async unwrap(wrapped: WrappedDek, tenantId: string): Promise<Uint8Array> {
    if (wrapped.kekKeyName !== this.options.keyName) {
      throw new Error(`この DEK は別の KEK(${wrapped.kekKeyName})でラップされています`);
    }
    const plaintext = await this.options.client.decrypt(
      this.options.keyName,
      Buffer.from(wrapped.wrapped).toString('base64'),
      dekWrapAad(tenantId).toString('base64'),
    );
    return Buffer.from(plaintext, 'base64');
  }
}
