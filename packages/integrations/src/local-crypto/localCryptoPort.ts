import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  CipherContext,
  CryptoPort,
  KeyManagementPort,
  TenantDataKeyReaderPort,
  TenantDataKeyRecord,
} from '@katahimo/core/ports';

/**
 * 暗号文の形式(v3):
 *   [0]      形式の版(0x03)
 *   [1..2]   DEK の版(tenant_data_keys.version、符号なし16ビット)
 *   [3..14]  nonce(12バイト、値ごとにランダム)
 *   [15..]   AES-256-GCM の暗号文 | 認証タグ(16バイト)
 * AAD は `katahimo/field/v3 \0 テナントID \0 用途(テーブル.列) \0 行ID`。先頭に DEK の版を書くため、
 * DEK をローテーション(新しい版を active にして古い版を decrypt_only に)しても古い暗号文を読める。
 */
const FORMAT_V3 = 0x03;
const HEADER_BYTES = 3;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function fieldAad(context: CipherContext): Buffer {
  return Buffer.from(`katahimo/field/v3\0${context.tenantId}\0${context.purpose}\0${context.rowId}`, 'utf8');
}

interface TenantKeys {
  activeVersion: number;
  deks: Map<number, Promise<Uint8Array>>;
  records: Map<number, TenantDataKeyRecord>;
}

/**
 * CryptoPort の実装(エンベロープ暗号化)。テナントの DEK はテナント作成時(provision_tenant)に作られ、KEK で
 * ラップした値だけが tenant_data_keys にある。アンラップした DEK はプロセス内に版ごとにキャッシュする。
 *
 * キャッシュは Promise を持つ(single-flight): 同じテナント・版を同時に要求しても KMS・DB への問い合わせは
 * 1回で、失敗した Promise はキャッシュから外す(次の要求でやり直す)。active の版は keysTtlMs ごとに
 * 読み直す(ローテーションを再起動なしで反映するため)。
 */
export class LocalCryptoPort implements CryptoPort {
  private readonly tenants = new Map<string, { expiresAt: number; keys: Promise<TenantKeys> }>();

  constructor(
    private readonly dataKeys: TenantDataKeyReaderPort,
    private readonly kms: KeyManagementPort,
    private readonly keysTtlMs = 10 * 60 * 1000,
  ) {}

  private loadKeys(tenantId: string): Promise<TenantKeys> {
    const cached = this.tenants.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.keys;
    const keys = this.dataKeys.listUsable(tenantId).then((records) => {
      const active = records.find((r) => r.state === 'active');
      if (!active) {
        throw new Error(
          `テナント(${tenantId})に有効なデータ暗号化鍵がありません(未作成、または暗号学的削除済み)`,
        );
      }
      const previous = cached ? cached.keys.catch(() => null) : Promise.resolve(null);
      return previous.then((old) => ({
        activeVersion: active.version,
        // 読み直しの前にアンラップ済みの DEK は引き継ぐ(KMS を呼び直さない)
        deks: old?.deks ?? new Map<number, Promise<Uint8Array>>(),
        records: new Map(records.map((r) => [r.version, r])),
      }));
    });
    this.tenants.set(tenantId, { expiresAt: Date.now() + this.keysTtlMs, keys });
    keys.catch(() => {
      if (this.tenants.get(tenantId)?.keys === keys) this.tenants.delete(tenantId);
    });
    return keys;
  }

  private async dek(
    tenantId: string,
    version: number | 'active',
  ): Promise<{ version: number; dek: Uint8Array }> {
    const keys = await this.loadKeys(tenantId);
    const resolved = version === 'active' ? keys.activeVersion : version;
    let dek = keys.deks.get(resolved);
    if (!dek) {
      const record = keys.records.get(resolved);
      if (!record) {
        throw new Error(
          `テナント(${tenantId})のデータ暗号化鍵の版 ${resolved} がありません(破棄済みの可能性)`,
        );
      }
      dek = this.kms.unwrap({ wrapped: record.wrappedDek, kekKeyName: record.kekKeyName }, tenantId);
      keys.deks.set(resolved, dek);
      const pending = dek;
      pending.catch(() => {
        if (keys.deks.get(resolved) === pending) keys.deks.delete(resolved);
      });
    }
    return { version: resolved, dek: await dek };
  }

  async encrypt(context: CipherContext, plaintext: string): Promise<Uint8Array> {
    const { version, dek } = await this.dek(context.tenantId, 'active');
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(fieldAad(context));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const header = Buffer.from([FORMAT_V3, (version >> 8) & 0xff, version & 0xff]);
    return Buffer.concat([header, nonce, body, cipher.getAuthTag()]);
  }

  async decrypt(context: CipherContext, ciphertext: Uint8Array): Promise<string> {
    const bytes = Buffer.from(ciphertext);
    if (bytes.length < HEADER_BYTES + NONCE_BYTES + TAG_BYTES || bytes[0] !== FORMAT_V3) {
      throw new Error(`未対応の暗号文の形式です(用途=${context.purpose})`);
    }
    const version = bytes.readUInt16BE(1);
    const { dek } = await this.dek(context.tenantId, version);
    const nonce = bytes.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce);
    decipher.setAAD(fieldAad(context));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    const body = bytes.subarray(HEADER_BYTES + NONCE_BYTES, bytes.length - TAG_BYTES);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }
}
