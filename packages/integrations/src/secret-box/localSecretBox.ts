import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { TenantSecretName } from '@katahimo/core/domain';
import type { SecretBoxPort } from '@katahimo/core/ports';
import { secretBinding } from './secretBinding';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * SecretBoxPort の開発用実装。環境変数の鍵(SECRET_BOX_LOCAL_KEY、32バイト)で AES-256-GCM により封をする
 * (本番は CloudKmsSecretBox)。暗号文は nonce(12) | 暗号文 | 認証タグ(16)。
 */
export class LocalSecretBox implements SecretBoxPort {
  private readonly key: Buffer;

  constructor(keyHex: string) {
    if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
      throw new Error(
        'SECRET_BOX_LOCAL_KEY は32バイト(64桁の16進数)で指定してください。' +
          "生成例: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      );
    }
    this.key = Buffer.from(keyHex, 'hex');
  }

  async seal(tenantId: string, name: TenantSecretName, plaintext: string): Promise<Uint8Array> {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(secretBinding(tenantId, name));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  async open(tenantId: string, name: TenantSecretName, sealed: Uint8Array): Promise<string> {
    const bytes = Buffer.from(sealed);
    if (bytes.length < NONCE_BYTES + TAG_BYTES) throw new Error('秘密値の形式が正しくありません');
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, NONCE_BYTES));
    decipher.setAAD(secretBinding(tenantId, name));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }
}
