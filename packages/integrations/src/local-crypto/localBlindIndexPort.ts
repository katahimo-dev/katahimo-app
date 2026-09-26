import { hkdfSync } from 'node:crypto';
import { computeBlindIndex } from '@katahimo/core/domain';
import type { BlindIndexPort, BlindIndexPurpose } from '@katahimo/core/ports';

/** ブラインドインデックスの鍵の版(値の先頭1バイト)。マスターキーを替えるときに上げ、再計算のジョブで移す。 */
export const BLIND_INDEX_KEY_VERSION = 1;

/**
 * BlindIndexPort の実装(本番もこれを使う。鍵は BLIND_INDEX_MASTER_KEY = Secret Manager の katahimo-blind-index-key)。
 * テナント・用途ごとの鍵をマスターキーから HKDF-SHA256 で導出する(info にテナントIDと用途)。暗号化の鍵
 * (DEK / KEK)とは別の系統にし、一方の漏洩だけでは他方に届かないようにする。値は [鍵の版(1バイト)] | HMAC-SHA256。
 */
export class LocalBlindIndexPort implements BlindIndexPort {
  private readonly masterKey: Buffer;
  private readonly keys = new Map<string, Buffer>();

  constructor(masterKeyHex: string) {
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
  }

  private keyFor(tenantId: string, purpose: BlindIndexPurpose): Buffer {
    const id = `${tenantId}\0${purpose}`;
    let key = this.keys.get(id);
    if (!key) {
      key = Buffer.from(
        hkdfSync(
          'sha256',
          this.masterKey,
          Buffer.alloc(0),
          `katahimo/blind-index/v${BLIND_INDEX_KEY_VERSION}\0${tenantId}\0${purpose}`,
          32,
        ),
      );
      this.keys.set(id, key);
    }
    return key;
  }

  async compute(tenantId: string, purpose: BlindIndexPurpose, normalizedValue: string): Promise<Uint8Array> {
    const mac = Buffer.from(computeBlindIndex(normalizedValue, this.keyFor(tenantId, purpose)), 'hex');
    return Buffer.concat([Buffer.from([BLIND_INDEX_KEY_VERSION]), mac]);
  }
}
