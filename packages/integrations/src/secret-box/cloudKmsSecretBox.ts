import type { TenantSecretName } from '@katahimo/core/domain';
import type { SecretBoxPort } from '@katahimo/core/ports';
import { secretBinding } from './secretBinding';

/** CloudKmsSecretBox が使う Cloud KMS の encrypt / decrypt(Base64 の入出力)。本番は cloudKmsApiClient.ts。 */
export interface CloudKmsClient {
  /** aadBase64 は Cloud KMS の additionalAuthenticatedData(復号時にも同じ値が必要)。 */
  encrypt(keyName: string, plaintextBase64: string, aadBase64: string): Promise<string>;
  decrypt(keyName: string, ciphertextBase64: string, aadBase64: string): Promise<string>;
}

const KEY_NAME_PATTERN = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/;

/**
 * SecretBoxPort の本番実装。秘密値を Cloud KMS の対称鍵で直接 encrypt / decrypt する(鍵の中身は KMS の外に
 * 出ない)。鍵のローテーションは KMS 側で新しい鍵バージョンを作るだけでよい(暗号文に使った版が含まれるため、
 * 古い版を無効にしない限り保存済みの値も開ける)。
 */
export class CloudKmsSecretBox implements SecretBoxPort {
  constructor(
    private readonly keyName: string,
    private readonly client: CloudKmsClient,
  ) {
    if (!KEY_NAME_PATTERN.test(keyName)) {
      throw new Error(
        `KMS の鍵名が不正です: ${keyName}(projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k> の形式)`,
      );
    }
  }

  async seal(tenantId: string, name: TenantSecretName, plaintext: string): Promise<Uint8Array> {
    const ciphertext = await this.client.encrypt(
      this.keyName,
      Buffer.from(plaintext, 'utf8').toString('base64'),
      secretBinding(tenantId, name).toString('base64'),
    );
    return Buffer.from(ciphertext, 'base64');
  }

  async open(tenantId: string, name: TenantSecretName, sealed: Uint8Array): Promise<string> {
    const plaintext = await this.client.decrypt(
      this.keyName,
      Buffer.from(sealed).toString('base64'),
      secretBinding(tenantId, name).toString('base64'),
    );
    return Buffer.from(plaintext, 'base64').toString('utf8');
  }
}
