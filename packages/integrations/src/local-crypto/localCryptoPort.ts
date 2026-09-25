import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  AuditLogPort,
  CryptoPort,
  EncryptedValue,
  EncryptionPurpose,
  KeyManagementPort,
  TenantKeyRepositoryPort,
} from '@katahimo/core/ports';

interface CachedDek {
  dek: Buffer;
  dekVersion: number;
}

/** 暗号文の形式の版。保存する値の先頭に `v2:` を付ける(将来形式を変えるときに見分けるため)。 */
const FORMAT_PREFIX = 'v2:';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-GCMの追加認証データ(AAD)。テナントIDと用途(`テーブル.列`)に結び付け、暗号文を別のテナント・
 * 別の列にコピーすると復号に失敗する(認証タグの検証で改ざんとして検出される)ようにする。
 * 行IDは含めない(多くの行はINSERTの時点でIDが決まらず、attendance_day_changes のように同じ暗号文を
 * 別の行へ写す使い方もあるため)。
 */
export function fieldAad(tenantId: string, purpose: EncryptionPurpose): Buffer {
  return Buffer.from(`katahimo/field/v2\0${tenantId}\0${purpose}`, 'utf8');
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
 * キャッシュする(プロセス生存期間のみ有効。DEKの実体をリクエストのたびにKMS/DBへ問い合わせる
 * コストを避けるため)。KEKローテーション(rewrap)はDEKの値自体を変えないため、このキャッシュに
 * 影響しない。DEKそのもののローテーションは未実装(対応する再暗号化バッチと合わせて実装する必要が
 * ある。将来の課題)。
 *
 * アルゴリズムはAES-256-GCM(認証付き・値ごとにランダムなnonce)。同じ平文でも呼ぶたびに
 * 異なる暗号文になるため、決定的暗号化のような統計的漏洩がない。
 *
 * 保存形式(2026-09 のセキュリティレビューで変更): `v2:` + base64(nonce 12バイト | 認証タグ 16バイト |
 * 暗号文)、AADは fieldAad(テナントID・用途)。それより前の形式(接頭辞なし・AADなし)は読めない
 * (本番データはまだ無いため移行処理は持たない。開発DBは作り直す)。
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
      const wrapped = await this.kms.wrap(dek, tenantId);
      record = await this.tenantKeys.create(tenantId, wrapped.ciphertext, wrapped.kekVersion);
    }

    const dek = await this.kms.unwrap(
      { ciphertext: record.wrappedDek, kekVersion: record.kekVersion },
      tenantId,
    );
    const entry: CachedDek = { dek, dekVersion: record.dekVersion };
    this.dekCache.set(tenantId, entry);
    return entry;
  }

  async encrypt(tenantId: string, plaintext: string, purpose: EncryptionPurpose): Promise<EncryptedValue> {
    const { dek, dekVersion } = await this.getOrCreateDek(tenantId);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dek, nonce);
    cipher.setAAD(fieldAad(tenantId, purpose));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const payload = Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    return { ciphertext: `${FORMAT_PREFIX}${payload.toString('base64')}`, keyVersion: dekVersion };
  }

  async decrypt(tenantId: string, value: EncryptedValue, purpose: EncryptionPurpose): Promise<string> {
    const { dek, dekVersion } = await this.getOrCreateDek(tenantId);
    if (value.keyVersion !== dekVersion) {
      // 過去バージョンのDEKを保持する仕組みがまだ無いため、現在のDEKと異なるバージョンで
      // 暗号化された値は復号できない(DEKローテーション実装時に合わせて対応する)。
      throw new Error(
        `未対応のDEKバージョンです(tenantId=${tenantId}, keyVersion=${value.keyVersion}, 現在のDEKバージョン=${dekVersion})。`,
      );
    }
    if (!value.ciphertext.startsWith(FORMAT_PREFIX)) {
      throw new Error(
        `未対応の暗号文の形式です(tenantId=${tenantId}, 用途=${purpose})。2026-09 より前の形式の開発DBは作り直してください。`,
      );
    }
    this.auditLog?.recordDecrypt({ tenantId });
    const payload = Buffer.from(value.ciphertext.slice(FORMAT_PREFIX.length), 'base64');
    const nonce = payload.subarray(0, NONCE_BYTES);
    const authTag = payload.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const encrypted = payload.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', dek, nonce);
    decipher.setAAD(fieldAad(tenantId, purpose));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
