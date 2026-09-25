import type { TenantKeyRecord, TenantKeyRepositoryPort } from '@katahimo/core/ports';
import { describe, expect, it } from 'vitest';
import { LocalKmsPort } from '../local-kms';
import { LocalBlindIndexPort } from './localBlindIndexPort';
import { LocalCryptoPort } from './localCryptoPort';

class MemoryTenantKeys implements TenantKeyRepositoryPort {
  readonly rows = new Map<string, TenantKeyRecord>();
  async find(tenantId: string) {
    return this.rows.get(tenantId) ?? null;
  }
  async create(tenantId: string, wrappedDek: string, kekVersion: number) {
    const record = { tenantId, dekVersion: 1, wrappedDek, kekVersion, revokedAt: null };
    this.rows.set(tenantId, record);
    return record;
  }
  async updateWrappedDek() {}
  async revoke() {}
}

const KEK = 'cd'.repeat(32);

function setup() {
  const tenantKeys = new MemoryTenantKeys();
  const kms = new LocalKmsPort(KEK);
  return { tenantKeys, kms, crypto: new LocalCryptoPort(tenantKeys, kms) };
}

describe('LocalCryptoPort(AES-256-GCM + AAD)', () => {
  it('同じテナント・同じ用途なら復号でき、形式の版(v2:)が付く', async () => {
    const { crypto } = setup();
    const enc = await crypto.encrypt('t1', 'アレルギー: 卵', 'family_members.allergy');
    expect(enc.ciphertext.startsWith('v2:')).toBe(true);
    expect(await crypto.decrypt('t1', enc, 'family_members.allergy')).toBe('アレルギー: 卵');
  });

  it('別の列(用途)にコピーした暗号文は復号できない', async () => {
    const { crypto } = setup();
    const enc = await crypto.encrypt('t1', 'secret', 'app_settings.gemini_api_key');
    await expect(crypto.decrypt('t1', enc, 'customers.memo')).rejects.toThrow();
  });

  it('別テナントの行にコピーした暗号文は(同じDEKを持っていても)復号できない', async () => {
    const { crypto, tenantKeys } = setup();
    const enc = await crypto.encrypt('t1', 'secret', 'customers.memo');
    // t2 に t1 と同じDEKを持たせても、AADのテナントIDが違うため認証に失敗する
    const t1 = await tenantKeys.find('t1');
    const kms = new LocalKmsPort(KEK);
    const dek = await kms.unwrap({ ciphertext: t1?.wrappedDek ?? '', kekVersion: 1 }, 't1');
    const rewrapped = await kms.wrap(dek, 't2');
    await tenantKeys.create('t2', rewrapped.ciphertext, 1);
    await expect(crypto.decrypt('t2', enc, 'customers.memo')).rejects.toThrow();
  });

  it('旧形式(接頭辞なし)の暗号文は明示的なエラーにする', async () => {
    const { crypto } = setup();
    await crypto.encrypt('t1', 'x', 'customers.memo'); // DEKを作る
    await expect(
      crypto.decrypt('t1', { ciphertext: 'AAAA', keyVersion: 1 }, 'customers.memo'),
    ).rejects.toThrow(/未対応の暗号文の形式/);
  });
});

describe('LocalKmsPort(DEKのラップにテナントIDを結び付ける)', () => {
  it('別テナントとしてはアンラップできない', async () => {
    const kms = new LocalKmsPort(KEK);
    const wrapped = await kms.wrap(Buffer.alloc(32, 7), 't1');
    expect(await kms.unwrap(wrapped, 't1')).toEqual(Buffer.alloc(32, 7));
    await expect(kms.unwrap(wrapped, 't2')).rejects.toThrow();
  });
});

describe('LocalBlindIndexPort(HKDFでテナントごとの鍵を導出)', () => {
  it('同じテナント・同じ値なら同じ、テナントが違えば別の値になる', async () => {
    const port = new LocalBlindIndexPort('ef'.repeat(32));
    const a = await port.compute('t1', '佐藤');
    expect(await port.compute('t1', '佐藤')).toBe(a);
    expect(await port.compute('t2', '佐藤')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
