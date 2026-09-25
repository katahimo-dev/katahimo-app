import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyManagementPort, WrappedDek } from '@katahimo/core/ports';

/**
 * KeyManagementPortの開発用実装。
 *
 * 本番はCloud KMSの`CryptoKeyVersion`でDEKをラップする実装に差し替える(Phase 5、実際の
 * GCPプロジェクト・KMSキーリングが用意でき次第)。ここでは、その日が来るまでローカル開発・
 * PoC公開で動かせるよう、環境変数のKEK(32バイト、64桁hex)1本でAES-256-GCMラップを行う
 * 簡易実装にとどめる。
 *
 * 旧LocalCryptoPort実装(マスターキー+tenantIdからSHA256でテナント鍵を決定的に導出)との
 * 違い: このKEKは「DEKそのもの」を暗号化するためだけに使い、DEKの値自体はテナントごとに
 * `crypto.randomBytes`で独立に生成する(tenantKeyRepository.create参照)。KEKが漏洩しても、
 * 攻撃者は各テナントの`wrapped_dek`(DBの実データ)も別途手に入れない限り実値を復号できない。
 *
 * kekVersionは常に1を返す(実際のKEKローテーションが必要になった時点でロジックを足す。
 * 環境変数を複数バージョン管理する形に拡張する想定)。
 */
export class LocalKmsPort implements KeyManagementPort {
  readonly currentKekVersion = 1;
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

  async wrap(dek: Buffer): Promise<WrappedDek> {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek, nonce);
    const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([nonce, authTag, wrapped]);
    return { ciphertext: payload.toString('base64'), kekVersion: this.currentKekVersion };
  }

  async unwrap(wrapped: WrappedDek): Promise<Buffer> {
    if (wrapped.kekVersion !== this.currentKekVersion) {
      throw new Error(
        `未対応のKEKバージョンです(kekVersion=${wrapped.kekVersion})。LocalKmsPortは複数バージョンの` +
          'KEKを保持しない簡易実装のため、ローテーション済みの場合は再ラップ(rewrap)が必要です。',
      );
    }
    const payload = Buffer.from(wrapped.ciphertext, 'base64');
    const nonce = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
