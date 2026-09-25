import { createHash } from 'node:crypto';
import type { StoragePort, StoredFile } from '@katahimo/core/ports';

/**
 * GcsStoragePort が使う Cloud Storage の最小限の操作。本番は googleapis の JSON API
 * (gcsJsonApiClient.ts)、テストはインメモリの偽物を渡す。
 */
export interface GcsObjectClient {
  upload(bucket: string, name: string, contentType: string, body: Uint8Array): Promise<void>;
  /** 存在しなければ null。 */
  download(bucket: string, name: string): Promise<Uint8Array | null>;
  /** 存在しなくてもエラーにしない。 */
  remove(bucket: string, name: string): Promise<void>;
}

/** V4 署名付きURLの署名に使うサービスアカウント(Cloud Run の実行SAなら IAM signBlob で署名する)。 */
export interface GcsUrlSigner {
  /** 署名するサービスアカウントのメールアドレス(X-Goog-Credential に入る)。 */
  getClientEmail(): Promise<string>;
  /** RSA-SHA256 署名(Base64)。 */
  sign(stringToSign: string): Promise<string>;
}

export interface GcsStoragePortOptions {
  bucket: string;
  client: GcsObjectClient;
  signer: GcsUrlSigner;
  /** テスト用。署名付きURLの発行時刻。 */
  now?: () => Date;
}

const STORAGE_HOST = 'storage.googleapis.com';
/** GCS の V4 署名付きURLの有効期限の上限(7日)。 */
const MAX_SIGNED_URL_SEC = 7 * 24 * 60 * 60;

/** RFC 3986 の非予約文字以外をすべて % エンコードする(V4 署名の正規化規則)。 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * StoragePort の Cloud Storage 実装(本番の領収書画像の保存先)。
 *
 * key は usecase が `${tenantId}/receipts/${randomUUID()}.jpg` の形で生成した値だけが渡る前提
 * (LocalFileStoragePort と同じ)。念のため `..` を含むキーや先頭が `/` のキーは拒否する
 * (GCS にディレクトリの概念は無いが、接頭辞による権限・ライフサイクル設定を壊さないため)。
 * オブジェクトの公開はしない(バケットは均一なバケットレベルのアクセス + 公開アクセス防止)。
 */
export class GcsStoragePort implements StoragePort {
  private readonly now: () => Date;

  constructor(private readonly options: GcsStoragePortOptions) {
    if (!options.bucket) throw new Error('GcsStoragePort: バケット名が必要です');
    this.now = options.now ?? (() => new Date());
  }

  private objectName(key: string): string {
    if (
      !key ||
      key.startsWith('/') ||
      key.split('/').some((segment) => segment === '..' || segment === '.')
    ) {
      throw new Error(`不正なストレージキーです: ${key}`);
    }
    return key;
  }

  async put(key: string, contentType: string, body: Uint8Array): Promise<StoredFile> {
    await this.options.client.upload(this.options.bucket, this.objectName(key), contentType, body);
    return { key, contentType, byteSize: body.byteLength };
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.options.client.download(this.options.bucket, this.objectName(key));
  }

  async delete(key: string): Promise<void> {
    await this.options.client.remove(this.options.bucket, this.objectName(key));
  }

  /**
   * V4 署名付きURL(GET、https://cloud.google.com/storage/docs/access-control/signing-urls-manually)。
   * Cloud Run の実行サービスアカウントで署名する場合、そのSA自身に対する
   * `roles/iam.serviceAccountTokenCreator`(iam.serviceAccounts.signBlob)が必要。
   */
  async signedUrl(key: string, expiresInSec: number): Promise<string> {
    const expires = Math.min(Math.max(1, Math.floor(expiresInSec)), MAX_SIGNED_URL_SEC);
    const timestamp = this.now()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const datestamp = timestamp.slice(0, 8);
    const scope = `${datestamp}/auto/storage/goog4_request`;
    const email = await this.options.signer.getClientEmail();

    const path = `/${this.options.bucket}/${this.objectName(key).split('/').map(encodeRfc3986).join('/')}`;
    const params: Array<[string, string]> = [
      ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
      ['X-Goog-Credential', `${email}/${scope}`],
      ['X-Goog-Date', timestamp],
      ['X-Goog-Expires', String(expires)],
      ['X-Goog-SignedHeaders', 'host'],
    ];
    // 正規化クエリはキー名の昇順(上の並びは昇順になっている)
    const query = params.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');
    const canonicalRequest = [
      'GET',
      path,
      query,
      `host:${STORAGE_HOST}`,
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = [
      'GOOG4-RSA-SHA256',
      timestamp,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const signature = Buffer.from(await this.options.signer.sign(stringToSign), 'base64').toString('hex');
    return `https://${STORAGE_HOST}${path}?${query}&X-Goog-Signature=${signature}`;
  }
}
