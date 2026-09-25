import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  AuditLogPort,
  CryptoPort,
  EncryptedValue,
  KeyManagementPort,
  TenantKeyRepositoryPort,
} from '@katahimo/core/ports';

interface CachedDek {
  dek: Buffer;
  dekVersion: number;
}

/**
 * CryptoPortの実装。テナントごとのDEK(データ暗号化鍵)によるエンベロープ暗号化を行う。
 *
 * 旧実装(マスターキー1本からSHA256でテナント鍵を都度導出)は、マスターキーが漏れれば
 * 全テナントの鍵を誰でも再計算できてしまい、実質「鍵を1本共有しているのと同じ」だった
 * (2026-08 データベース構造レビューで指摘)。この実装ではDEKをテナントごとに
 * `crypto.randomBytes`で独立に生成し、平文のままでは保存せず、常に
 * KeyManagementPort(KEK)でラップした状態のみをTenantKeyRepositoryPort経由でDBへ永続化する。
 *
 * DEKは初回アクセス時に遅延生成し(getOrCreateDek)、アンラップ結果をプロセス内メモリに
 * キャッシュする(GEOCODE_MEMO_CACHE_ 等と同様、プロセス生存期間のみ有効。DEKの実体を
 * リクエストのたびにKMS/DBへ問い合わせるコストを避けるため)。KEKローテーション(rewrap)は
 * DEKの値自体を変えないため、このキャッシュに影響しない。DEKそのもののローテーションは
 * 未実装(実行するとキャッシュ済みの古いDEKで復号できなくなるため、対応する再暗号化
 * バッチと合わせて実装する必要がある。将来の課題)。
 *
 * アルゴリズムはAES-256-GCM(認証付き・値ごとにランダムなnonce)。同じ平文でも呼ぶたびに
 * 異なる暗号文になるため、決定的暗号化のような統計的漏洩がない。
 */
export class LocalCryptoPort implements CryptoPort {
  private readonly dekCache = new Map<string, CachedDek>();

  constructor(
    private readonly tenantKeys: TenantKeyRepositoryPort,
    private readonly kms: KeyManagementPort,
    private readonly auditLog?: AuditLogPort,
  ) {}

  private async getOrCreateDek(tenantId: string): Promise<CachedDek> {
    const cached = this.dekCache.get(tenantId);
    if (cached) return cached;

    let record = await this.tenantKeys.find(tenantId);
    if (record?.revokedAt) {
      throw new Error(
        `テナント(${tenantId})の鍵は暗号学的削除(解約処理)済みのため、このテナントのデータは復号できません。`,
      );
    }
    if (!record) {
      const dek = randomBytes(32);
      const wrapped = await this.kms.wrap(dek);
      record = await this.tenantKeys.create(tenantId, wrapped.ciphertext, wrapped.kekVersion);
    }

    const dek = await this.kms.unwrap({ ciphertext: record.wrappedDek, kekVersion: record.kekVersion });
    const entry: CachedDek = { dek, dekVersion: record.dekVersion };
    this.dekCache.set(tenantId, entry);
    return entry;
  }

  async encrypt(tenantId: string, plaintext: string): Promise<EncryptedValue> {
    const { dek, dekVersion } = await this.getOrCreateDek(tenantId);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([nonce, authTag, encrypted]);
    return { ciphertext: payload.toString('base64'), keyVersion: dekVersion };
  }

  async decrypt(tenantId: string, value: EncryptedValue): Promise<string> {
    const { dek, dekVersion } = await this.getOrCreateDek(tenantId);
    if (value.keyVersion !== dekVersion) {
      // 過去バージョンのDEKを保持する仕組みがまだ無いため、現在のDEKと異なるバージョンで
      // 暗号化された値は復号できない(DEKローテーション実装時に合わせて対応する)。
      throw new Error(
        `未対応のDEKバージョンです(tenantId=${tenantId}, keyVersion=${value.keyVersion}, 現在のDEKバージョン=${dekVersion})。`,
      );
    }
    this.auditLog?.recordDecrypt({ tenantId });
    const payload = Buffer.from(value.ciphertext, 'base64');
    const nonce = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}
