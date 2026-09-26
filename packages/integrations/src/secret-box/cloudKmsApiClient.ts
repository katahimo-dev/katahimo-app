import type { cloudkms_v1 } from 'googleapis';
import type { CloudKmsClient } from './cloudKmsSecretBox';

const CLOUD_KMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';

/**
 * Application Default Credentials(Cloud Run の実行サービスアカウント)で Cloud KMS を呼ぶクライアント。
 * 実行SAには鍵に対する `roles/cloudkms.cryptoKeyEncrypterDecrypter` が必要(infra/gcp/kms.tf)。
 */
export function createCloudKmsApiClient(): CloudKmsClient {
  let kmsPromise: Promise<cloudkms_v1.Cloudkms> | null = null;
  const kms = () => {
    kmsPromise ??= import('googleapis').then(({ google }) =>
      google.cloudkms({ version: 'v1', auth: new google.auth.GoogleAuth({ scopes: [CLOUD_KMS_SCOPE] }) }),
    );
    return kmsPromise;
  };
  const keys = async () => (await kms()).projects.locations.keyRings.cryptoKeys;

  return {
    async encrypt(name, plaintext, additionalAuthenticatedData) {
      const res = await (await keys()).encrypt({
        name,
        requestBody: { plaintext, additionalAuthenticatedData },
      });
      if (!res.data.ciphertext) throw new Error('Cloud KMS encrypt の応答に ciphertext がありません');
      return res.data.ciphertext;
    },
    async decrypt(name, ciphertext, additionalAuthenticatedData) {
      const res = await (await keys()).decrypt({
        name,
        requestBody: { ciphertext, additionalAuthenticatedData },
      });
      if (!res.data.plaintext) throw new Error('Cloud KMS decrypt の応答に plaintext がありません');
      return res.data.plaintext;
    },
  };
}
