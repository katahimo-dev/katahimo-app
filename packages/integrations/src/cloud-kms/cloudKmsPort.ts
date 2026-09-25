import type { KeyManagementPort, WrappedDek } from '@katahimo/core/ports';

/** CloudKmsPort が使う Cloud KMS の暗号化/復号(Base64 の入出力)。本番は cloudKmsApiClient.ts。 */
export interface CloudKmsClient {
  encrypt(keyName: string, plaintextBase64: string): Promise<string>;
  decrypt(keyName: string, ciphertextBase64: string): Promise<string>;
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
 * - KEK の鍵マテリアルはKMSの外に出ない(LocalKmsPort の LOCAL_DEV_KEK に相当する秘密が環境変数に無い)。
 * - 鍵のローテーション(新しい CryptoKeyVersion の作成)はKMS側で行い、アプリの変更は不要。KMS の暗号文には
 *   使った鍵バージョンが含まれ、decrypt が自動で選ぶため、旧バージョンを無効化しない限り既存のDEKも復号できる。
 *   そのため kekVersion(tenant_keys.kek_version)は常に1のままでよい。
 * - DEK のアンラップ結果は LocalCryptoPort がプロセス内にキャッシュするため、KMS 呼び出しは
 *   インスタンス起動後のテナントごとの初回だけ。
 *
 * LocalKmsPort でラップ済みのDEKはこの実装では復号できない(暗号文の形式も鍵も違う)。本番は最初から
 * この実装を使うこと(途中で切り替える場合は、旧KEKでアンラップして再ラップする移行作業が別途必要)。
 */
export class CloudKmsPort implements KeyManagementPort {
  readonly currentKekVersion = 1;

  constructor(private readonly options: CloudKmsPortOptions) {
    if (!KEY_NAME_PATTERN.test(options.keyName)) {
      throw new Error(
        `KMS の鍵名が不正です: ${options.keyName}(projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k> の形式)`,
      );
    }
  }

  async wrap(dek: Buffer): Promise<WrappedDek> {
    const ciphertext = await this.options.client.encrypt(this.options.keyName, dek.toString('base64'));
    return { ciphertext, kekVersion: this.currentKekVersion };
  }

  async unwrap(wrapped: WrappedDek): Promise<Buffer> {
    if (wrapped.kekVersion !== this.currentKekVersion) {
      throw new Error(`未対応のKEKバージョンです(kekVersion=${wrapped.kekVersion})`);
    }
    return Buffer.from(await this.options.client.decrypt(this.options.keyName, wrapped.ciphertext), 'base64');
  }
}
