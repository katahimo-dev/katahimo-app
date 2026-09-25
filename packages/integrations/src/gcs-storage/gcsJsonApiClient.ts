import { Readable } from 'node:stream';
import type { GoogleAuth } from 'google-auth-library';
import type { storage_v1 } from 'googleapis';
import type { GcsObjectClient, GcsUrlSigner } from './gcsStoragePort';

const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

/** googleapis(gaxios)のエラーは HTTP ステータスを code / status に持つ。 */
function isNotFound(error: unknown): boolean {
  const e = error as { code?: unknown; status?: unknown } | null;
  return e?.code === 404 || e?.status === 404;
}

/**
 * Application Default Credentials(Cloud Run の実行サービスアカウント)で Cloud Storage の JSON API を
 * 呼ぶクライアントと、署名付きURL用の署名者。googleapis は読み込みが重いため最初の呼び出しまで遅らせる
 * (calendarApiClient.ts と同じ)。
 */
export function createGcsJsonApiClient(): { client: GcsObjectClient; signer: GcsUrlSigner } {
  let loaded: Promise<{ storage: storage_v1.Storage; auth: GoogleAuth }> | null = null;
  const load = () => {
    loaded ??= import('googleapis').then(({ google }) => {
      const auth = new google.auth.GoogleAuth({ scopes: [STORAGE_SCOPE] });
      return { storage: google.storage({ version: 'v1', auth }), auth };
    });
    return loaded;
  };

  const client: GcsObjectClient = {
    async upload(bucket, name, contentType, body) {
      const { storage } = await load();
      await storage.objects.insert({
        bucket,
        name,
        requestBody: { name, contentType },
        media: { mimeType: contentType, body: Readable.from(Buffer.from(body)) },
      });
    },
    async download(bucket, name) {
      const { storage } = await load();
      try {
        const res = await storage.objects.get(
          { bucket, object: name, alt: 'media' },
          { responseType: 'arraybuffer' },
        );
        return new Uint8Array(res.data as unknown as ArrayBuffer);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async remove(bucket, name) {
      const { storage } = await load();
      try {
        await storage.objects.delete({ bucket, object: name });
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };

  const signer: GcsUrlSigner = {
    async getClientEmail() {
      const { auth } = await load();
      const { client_email: email } = await auth.getCredentials();
      if (!email) throw new Error('署名に使うサービスアカウントのメールアドレスを取得できません');
      return email;
    },
    async sign(stringToSign) {
      const { auth } = await load();
      return auth.sign(stringToSign);
    },
  };

  return { client, signer };
}
