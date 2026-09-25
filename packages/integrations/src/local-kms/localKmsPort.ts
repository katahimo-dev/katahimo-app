import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyManagementPort, WrappedDek } from '@katahimo/core/ports';
import { dekWrapAad } from './dekWrapAad';

/** tenant_data_keys.kek_key_name に入る名前(開発用の KEK)。 */
export const LOCAL_KEK_NAME = 'local';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * KeyManagementPort の開発用実装。環境変数の KEK(LOCAL_DEV_KEK、32バイト)1本で DEK を AES-256-GCM で
 * ラップする(本番は CloudKmsPort)。ラップ済みの値は nonce(12) | 暗号文 | 認証タグ(16)、AAD はテナントID。
 */
export class LocalKmsPort implements KeyManagementPort {
  private readonly kek: Buffer;

  constructor(kekHex: string) {
    if (!/^[0-9a-f]{64}$/i.test(kekHex)) {
      throw new Error(
        'LOCAL_DEV_KEK は32バイト(64桁の16進数)で指定してください。' +
          "生成例: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    this.kek = Buffer.from(kekHex, 'hex');
  }

  async wrap(dek: Uint8Array, tenantId: string): Promise<WrappedDek> {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.kek, nonce);
    cipher.setAAD(dekWrapAad(tenantId));
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    return { wrapped: Buffer.concat([nonce, body, cipher.getAuthTag()]), kekKeyName: LOCAL_KEK_NAME };
  }

  async unwrap(wrapped: WrappedDek, tenantId: string): Promise<Uint8Array> {
    if (wrapped.kekKeyName !== LOCAL_KEK_NAME) {
      throw new Error(
        `この DEK は別の KEK(${wrapped.kekKeyName})でラップされています(KMS_PROVIDER の設定を確かめてください)`,
      );
    }
    const bytes = Buffer.from(wrapped.wrapped);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, bytes.subarray(0, NONCE_BYTES));
    decipher.setAAD(dekWrapAad(tenantId));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]);
  }
}
