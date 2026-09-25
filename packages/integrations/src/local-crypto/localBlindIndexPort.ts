import { createHash } from 'node:crypto';
import { computeBlindIndex } from '@katahimo/core/domain';
import type { BlindIndexPort } from '@katahimo/core/ports';

/**
 * BlindIndexPortの開発用実装。CryptoPortとは別の鍵導出にする
 * (暗号化鍵とインデックス鍵が同じだと権限分離の意味が薄れるため、意図的に文字列を変えている)。
 */
export class LocalBlindIndexPort implements BlindIndexPort {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex: string) {
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
  }

  private deriveTenantIndexKey(tenantId: string): Buffer {
    return createHash('sha256').update(this.masterKey).update(':blind-index:').update(tenantId).digest();
  }

  async compute(tenantId: string, normalizedValue: string): Promise<string> {
    return computeBlindIndex(normalizedValue, this.deriveTenantIndexKey(tenantId));
  }
}
