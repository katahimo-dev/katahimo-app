import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type CloudKmsClient, CloudKmsPort } from './cloudKmsPort';

const KEY = 'projects/my-proj/locations/asia-northeast1/keyRings/katahimo/cryptoKeys/tenant-kek';

/** 暗号文の代わりに「鍵名|AAD|平文」を返す偽物。呼び出しの記録も取る。 */
function fakeKms() {
  const calls: Array<{ op: 'encrypt' | 'decrypt'; keyName: string }> = [];
  const client: CloudKmsClient = {
    async encrypt(keyName, plaintext, aad) {
      calls.push({ op: 'encrypt', keyName });
      return Buffer.from(`${keyName}|${aad}|${plaintext}`).toString('base64');
    },
    async decrypt(keyName, ciphertext, aad) {
      calls.push({ op: 'decrypt', keyName });
      const [usedKey, usedAad, plaintext] = Buffer.from(ciphertext, 'base64').toString().split('|');
      if (usedKey !== keyName) throw new Error('別の鍵の暗号文です');
      if (usedAad !== aad) throw new Error('AADが一致しません');
      return plaintext ?? '';
    },
  };
  return { client, calls };
}

describe('CloudKmsPort', () => {
  it('DEK を KMS の鍵でラップし、同じ鍵でアンラップすると元に戻る', async () => {
    const { client, calls } = fakeKms();
    const port = new CloudKmsPort({ keyName: KEY, client });
    const dek = randomBytes(32);

    const wrapped = await port.wrap(dek, 'tenant-1');
    expect(wrapped.kekVersion).toBe(1);
    expect(wrapped.ciphertext.startsWith('v2:')).toBe(true);
    expect(wrapped.ciphertext).not.toContain(dek.toString('base64'));
    expect(await port.unwrap(wrapped, 'tenant-1')).toEqual(dek);
    expect(calls).toEqual([
      { op: 'encrypt', keyName: KEY },
      { op: 'decrypt', keyName: KEY },
    ]);
  });

  it('テナントIDをAADに結び付け、別テナントとしてはアンラップできない', async () => {
    const { client } = fakeKms();
    const port = new CloudKmsPort({ keyName: KEY, client });
    const wrapped = await port.wrap(randomBytes(32), 'tenant-1');
    await expect(port.unwrap(wrapped, 'tenant-2')).rejects.toThrow(/AAD/);
  });

  it('未知の kekVersion は KMS を呼ばずに拒否する', async () => {
    const { client, calls } = fakeKms();
    const port = new CloudKmsPort({ keyName: KEY, client });
    await expect(port.unwrap({ ciphertext: 'x', kekVersion: 2 }, 'tenant-1')).rejects.toThrow(/kekVersion=2/);
    expect(calls).toEqual([]);
  });

  it('鍵名の形式が違えば起動時に落とす(鍵バージョン付きの名前も不可)', () => {
    const { client } = fakeKms();
    expect(() => new CloudKmsPort({ keyName: 'tenant-kek', client })).toThrow(/KMS の鍵名/);
    expect(() => new CloudKmsPort({ keyName: `${KEY}/cryptoKeyVersions/1`, client })).toThrow(/KMS の鍵名/);
  });
});
