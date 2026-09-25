import { hkdfSync } from 'node:crypto';
import { computeBlindIndex } from '@katahimo/core/domain';
import type { BlindIndexPort } from '@katahimo/core/ports';

/**
 * BlindIndexPortの実装(名前に反して本番もこれを使う。鍵は LOCAL_DEV_MASTER_KEY)。
 * テナントごとのインデックス鍵をマスターキーからHKDF-SHA256で導出する(info にテナントIDと用途の
 * ラベルを含める。CryptoPortの鍵とは別系統で、暗号化鍵とインデックス鍵を分ける権限分離のため)。
 *
 * 2026-09 のセキュリティレビューで導出方法を sha256(masterKey:blind-index:tenantId) から HKDF に
 * 変えたため、それより前に計算したインデックスとは一致しない(開発DBは作り直す)。
 */
export class LocalBlindIndexPort implements BlindIndexPort {
  private readonly masterKey: Buffer;
  private readonly tenantKeys = new Map<string, Buffer>();

  constructor(masterKeyHex: string) {
    this.masterKey = Buffer.from(masterKeyHex, 'hex');
  }

  private deriveTenantIndexKey(tenantId: string): Buffer {
    const cached = this.tenantKeys.get(tenantId);
    if (cached) return cached;
    const key = Buffer.from(
      hkdfSync('sha256', this.masterKey, Buffer.alloc(0), `katahimo/blind-index/v2\0${tenantId}`, 32),
    );
    this.tenantKeys.set(tenantId, key);
    return key;
  }

  async compute(tenantId: string, normalizedValue: string): Promise<string> {
    return computeBlindIndex(normalizedValue, this.deriveTenantIndexKey(tenantId));
  }
}
