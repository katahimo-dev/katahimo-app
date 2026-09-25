import { createHash, createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type GcsObjectClient, GcsStoragePort, type GcsUrlSigner } from './gcsStoragePort';

class FakeGcsClient implements GcsObjectClient {
  readonly objects = new Map<string, { contentType: string; body: Uint8Array }>();

  async upload(bucket: string, name: string, contentType: string, body: Uint8Array): Promise<void> {
    this.objects.set(`${bucket}/${name}`, { contentType, body });
  }
  async download(bucket: string, name: string): Promise<Uint8Array | null> {
    return this.objects.get(`${bucket}/${name}`)?.body ?? null;
  }
  async remove(bucket: string, name: string): Promise<void> {
    this.objects.delete(`${bucket}/${name}`);
  }
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signed: string[] = [];
const signer: GcsUrlSigner = {
  async getClientEmail() {
    return 'katahimo-api@my-proj.iam.gserviceaccount.com';
  },
  async sign(stringToSign) {
    signed.push(stringToSign);
    return createSign('RSA-SHA256').update(stringToSign).sign(privateKey, 'base64');
  },
};

function createPort(client = new FakeGcsClient()) {
  const port = new GcsStoragePort({
    bucket: 'katahimo-receipts',
    client,
    signer,
    now: () => new Date('2026-09-25T01:02:03.456Z'),
  });
  return { port, client };
}

describe('GcsStoragePort', () => {
  it('キーをそのままオブジェクト名にして保存・取得・削除する', async () => {
    const { port, client } = createPort();
    const body = new Uint8Array([1, 2, 3]);
    const key = 'tenant-1/receipts/abc.jpg';

    expect(await port.put(key, 'image/jpeg', body)).toEqual({ key, contentType: 'image/jpeg', byteSize: 3 });
    expect([...client.objects.keys()]).toEqual(['katahimo-receipts/tenant-1/receipts/abc.jpg']);
    expect(await port.get(key)).toEqual(body);

    await port.delete(key);
    expect(await port.get(key)).toBeNull();
    // 存在しないキーの削除もエラーにしない
    await expect(port.delete(key)).resolves.toBeUndefined();
  });

  it('相対パスを含むキー・先頭が / のキーは拒否する', async () => {
    const { port } = createPort();
    await expect(port.put('../other/x.jpg', 'image/jpeg', new Uint8Array())).rejects.toThrow(
      /不正なストレージキー/,
    );
    await expect(port.get('/abs.jpg')).rejects.toThrow(/不正なストレージキー/);
    await expect(port.get('a/./b.jpg')).rejects.toThrow(/不正なストレージキー/);
  });

  it('V4 署名付きURLを発行する(正規化リクエストのハッシュに署名し、有効期限は7日で頭打ち)', async () => {
    const { port } = createPort();
    signed.length = 0;
    const url = new URL(await port.signedUrl('tenant-1/receipts/領収書 (1).jpg', 30 * 24 * 60 * 60));

    expect(url.origin).toBe('https://storage.googleapis.com');
    expect(url.pathname).toBe(
      `/katahimo-receipts/tenant-1/receipts/${encodeURIComponent('領収書')}%20%281%29.jpg`,
    );
    expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
    expect(url.searchParams.get('X-Goog-Credential')).toBe(
      'katahimo-api@my-proj.iam.gserviceaccount.com/20260925/auto/storage/goog4_request',
    );
    expect(url.searchParams.get('X-Goog-Date')).toBe('20260925T010203Z');
    expect(url.searchParams.get('X-Goog-Expires')).toBe('604800');
    expect(url.searchParams.get('X-Goog-SignedHeaders')).toBe('host');

    const query = url.search.slice(1).replace(/&X-Goog-Signature=.*$/, '');
    const canonicalRequest = [
      'GET',
      url.pathname,
      query,
      'host:storage.googleapis.com',
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const expectedStringToSign = [
      'GOOG4-RSA-SHA256',
      '20260925T010203Z',
      '20260925/auto/storage/goog4_request',
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    expect(signed).toEqual([expectedStringToSign]);

    const signature = Buffer.from(url.searchParams.get('X-Goog-Signature') ?? '', 'hex');
    expect(createVerify('RSA-SHA256').update(expectedStringToSign).verify(publicKey, signature)).toBe(true);
  });
});
