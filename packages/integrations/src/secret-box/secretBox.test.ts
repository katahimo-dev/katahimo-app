import { describe, expect, it } from 'vitest';
import { type CloudKmsClient, CloudKmsSecretBox } from './cloudKmsSecretBox';
import { LocalSecretBox } from './localSecretBox';
import { createSecretBox, secretBoxEnvProblems } from './secretBoxProvider';

const localKey = 'ab'.repeat(32);
const keyName = 'projects/p/locations/asia-northeast1/keyRings/katahimo/cryptoKeys/tenant-secrets';

/** 暗号文の代わりに「鍵名|AAD|平文」を返す偽物。 */
function fakeKms(): CloudKmsClient {
  return {
    async encrypt(name, plaintext, aad) {
      return Buffer.from(`${name}|${aad}|${plaintext}`).toString('base64');
    },
    async decrypt(name, ciphertext, aad) {
      const [usedKey, usedAad, plaintext] = Buffer.from(ciphertext, 'base64').toString().split('|');
      if (usedKey !== name || usedAad !== aad) throw new Error('開けません');
      return plaintext ?? '';
    },
  };
}

describe.each([
  ['LocalSecretBox', () => new LocalSecretBox(localKey)],
  ['CloudKmsSecretBox', () => new CloudKmsSecretBox(keyName, fakeKms())],
])('%s', (_label, create) => {
  it('封をした値は平文を含まず、同じテナント・名前で開くと元に戻る', async () => {
    const box = create();
    const sealed = await box.seal('tenant-1', 'gemini_api_key', 'AIza-秘密');
    expect(Buffer.from(sealed).toString('utf8')).not.toContain('AIza-秘密');
    expect(await box.open('tenant-1', 'gemini_api_key', sealed)).toBe('AIza-秘密');
  });

  it('別のテナント・別の名前の行に写した暗号文は開けない', async () => {
    const box = create();
    const sealed = await box.seal(
      'tenant-1',
      'gchat_report_webhook',
      'https://chat.googleapis.com/v1/spaces/x',
    );
    await expect(box.open('tenant-2', 'gchat_report_webhook', sealed)).rejects.toThrow();
    await expect(box.open('tenant-1', 'gchat_receipt_webhook', sealed)).rejects.toThrow();
  });
});

describe('createSecretBox / secretBoxEnvProblems', () => {
  it('SECRET_BOX_PROVIDER で実装を切り替え、必要な設定が無ければ例外', () => {
    expect(createSecretBox({ SECRET_BOX_PROVIDER: 'local', SECRET_BOX_LOCAL_KEY: localKey })).toBeInstanceOf(
      LocalSecretBox,
    );
    expect(createSecretBox({ SECRET_BOX_PROVIDER: 'gcp', SECRET_BOX_KMS_KEY: keyName })).toBeInstanceOf(
      CloudKmsSecretBox,
    );
    expect(() => createSecretBox({ SECRET_BOX_PROVIDER: 'local' })).toThrow(/SECRET_BOX_LOCAL_KEY/);
    expect(() => createSecretBox({ SECRET_BOX_PROVIDER: 'gcp' })).toThrow(/SECRET_BOX_KMS_KEY/);
  });

  it('鍵の形式が違えば起動時に落とす(鍵バージョン付きの KMS の名前も不可)', () => {
    expect(() => new LocalSecretBox('short')).toThrow(/SECRET_BOX_LOCAL_KEY/);
    expect(() => new CloudKmsSecretBox(`${keyName}/cryptoKeyVersions/1`, fakeKms())).toThrow(/KMS の鍵名/);
  });

  it('本番は Cloud KMS を要求する', () => {
    expect(
      secretBoxEnvProblems({ SECRET_BOX_PROVIDER: 'local', SECRET_BOX_LOCAL_KEY: localKey }, false),
    ).toEqual([]);
    expect(secretBoxEnvProblems({ SECRET_BOX_PROVIDER: 'gcp', SECRET_BOX_KMS_KEY: keyName }, true)).toEqual(
      [],
    );
    expect(
      secretBoxEnvProblems({ SECRET_BOX_PROVIDER: 'local', SECRET_BOX_LOCAL_KEY: localKey }, true).join(),
    ).toMatch(/SECRET_BOX_PROVIDER/);
    expect(secretBoxEnvProblems({ SECRET_BOX_PROVIDER: 'gcp' }, true).join()).toMatch(/SECRET_BOX_KMS_KEY/);
    expect(
      secretBoxEnvProblems({ SECRET_BOX_PROVIDER: 'local', SECRET_BOX_LOCAL_KEY: localKey }, true, true),
    ).toEqual([]);
  });
});
