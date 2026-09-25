import { describe, expect, it } from 'vitest';
import { CloudKmsPort } from '../cloud-kms';
import { LocalKmsPort } from '../local-kms';
import { createKeyManagementPort, kmsEnvProblems } from './kmsProvider';

const kek = 'ab'.repeat(32);
const keyName = 'projects/p/locations/asia-northeast1/keyRings/katahimo/cryptoKeys/tenant-kek';

describe('createKeyManagementPort', () => {
  it('KMS_PROVIDER で実装を切り替える', () => {
    expect(createKeyManagementPort({ KMS_PROVIDER: 'local', LOCAL_DEV_KEK: kek })).toBeInstanceOf(
      LocalKmsPort,
    );
    expect(createKeyManagementPort({ KMS_PROVIDER: 'gcp', GCP_KMS_KEY_NAME: keyName })).toBeInstanceOf(
      CloudKmsPort,
    );
  });

  it('必要な設定が無ければ例外', () => {
    expect(() => createKeyManagementPort({ KMS_PROVIDER: 'local' })).toThrow(/LOCAL_DEV_KEK/);
    expect(() => createKeyManagementPort({ KMS_PROVIDER: 'gcp' })).toThrow(/GCP_KMS_KEY_NAME/);
  });
});

describe('kmsEnvProblems', () => {
  it('本番は Cloud KMS を要求し、それぞれの必須設定を検査する', () => {
    expect(kmsEnvProblems({ KMS_PROVIDER: 'local', LOCAL_DEV_KEK: kek }, false)).toEqual([]);
    expect(kmsEnvProblems({ KMS_PROVIDER: 'gcp', GCP_KMS_KEY_NAME: keyName }, true)).toEqual([]);
    expect(kmsEnvProblems({ KMS_PROVIDER: 'local', LOCAL_DEV_KEK: kek }, true).join()).toMatch(
      /KMS_PROVIDER/,
    );
    expect(kmsEnvProblems({ KMS_PROVIDER: 'local' }, false).join()).toMatch(/LOCAL_DEV_KEK/);
    expect(kmsEnvProblems({ KMS_PROVIDER: 'gcp' }, true).join()).toMatch(/GCP_KMS_KEY_NAME/);
  });
});
