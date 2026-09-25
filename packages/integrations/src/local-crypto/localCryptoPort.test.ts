import { randomBytes } from 'node:crypto';
import type { TenantDataKeyReaderPort, TenantDataKeyRecord } from '@katahimo/core/ports';
import { describe, expect, it } from 'vitest';
import { LocalKmsPort } from '../local-kms';
import { LocalBlindIndexPort } from './localBlindIndexPort';
import { LocalCryptoPort } from './localCryptoPort';

const KEK = 'cd'.repeat(32);

class MemoryDataKeys implements TenantDataKeyReaderPort {
  readonly rows = new Map<string, TenantDataKeyRecord[]>();
  calls = 0;
  async listUsable(tenantId: string) {
    this.calls++;
    return this.rows.get(tenantId) ?? [];
  }
  async add(kms: LocalKmsPort, tenantId: string, version: number, state: TenantDataKeyRecord['state']) {
    const wrapped = await kms.wrap(randomBytes(32), tenantId);
    const list = (this.rows.get(tenantId) ?? []).map((r) =>
      state === 'active' && r.state === 'active' ? { ...r, state: 'decrypt_only' as const } : r,
    );
    list.push({ version, wrappedDek: wrapped.wrapped, kekKeyName: wrapped.kekKeyName, state });
    this.rows.set(tenantId, list);
  }
}

async function setup() {
  const kms = new LocalKmsPort(KEK);
  const keys = new MemoryDataKeys();
  await keys.add(kms, 't1', 1, 'active');
  return { kms, keys, crypto: new LocalCryptoPort(keys, kms, 0) };
}

const memo = (rowId = 'row-1') => ({ tenantId: 't1', purpose: 'customers.memo' as const, rowId });

describe('LocalCryptoPort(AES-256-GCM・AAD・DEKの版)', () => {
  it('暗号文の先頭に形式と DEK の版を持ち、同じ文脈なら復号できる', async () => {
    const { crypto } = await setup();
    const enc = await crypto.encrypt(memo(), 'アレルギー: 卵');
    expect([...enc.subarray(0, 3)]).toEqual([3, 0, 1]);
    expect(await crypto.decrypt(memo(), enc)).toBe('アレルギー: 卵');
  });

  it('別の列・別の行・別のテナントに写した暗号文は復号できない', async () => {
    const { crypto, keys, kms } = await setup();
    const enc = await crypto.encrypt(memo(), 'secret');
    await expect(
      crypto.decrypt({ ...memo(), purpose: 'customers.benefit_member_id' }, enc),
    ).rejects.toThrow();
    await expect(crypto.decrypt(memo('row-2'), enc)).rejects.toThrow();
    await keys.add(kms, 't2', 1, 'active');
    await expect(crypto.decrypt({ ...memo(), tenantId: 't2' }, enc)).rejects.toThrow();
  });

  it('DEK をローテーションしても古い版の暗号文を読め、新しい暗号文は新しい版で書く', async () => {
    const { crypto, keys, kms } = await setup();
    const old = await crypto.encrypt(memo(), 'before');
    await keys.add(kms, 't1', 2, 'active');
    const fresh = await crypto.encrypt(memo(), 'after');
    expect(fresh[2]).toBe(2);
    expect(await crypto.decrypt(memo(), old)).toBe('before');
    expect(await crypto.decrypt(memo(), fresh)).toBe('after');
  });

  it('鍵の読み込みは同時の要求でも1回だけ、失敗した読み込みはキャッシュしない', async () => {
    const kms = new LocalKmsPort(KEK);
    const keys = new MemoryDataKeys();
    const crypto = new LocalCryptoPort(keys, kms, 60_000);
    await expect(crypto.encrypt(memo(), 'x')).rejects.toThrow(/有効なデータ暗号化鍵がありません/);
    await keys.add(kms, 't1', 1, 'active');
    keys.calls = 0;
    await Promise.all([
      crypto.encrypt(memo(), 'a'),
      crypto.encrypt(memo(), 'b'),
      crypto.encrypt(memo(), 'c'),
    ]);
    expect(keys.calls).toBe(1);
  });

  it('読み直した一覧に無い版(破棄した版)のアンラップ済みの DEK は捨て、その版の暗号文は復号できなくなる', async () => {
    const { crypto, keys, kms } = await setup();
    const old = await crypto.encrypt(memo(), 'before');
    await keys.add(kms, 't1', 2, 'active');
    expect(await crypto.decrypt(memo(), old)).toBe('before');
    // 版1を destroyed にする(listUsable は active / decrypt_only だけを返す)
    keys.rows.set(
      't1',
      (keys.rows.get('t1') ?? []).filter((r) => r.version !== 1),
    );
    await expect(crypto.decrypt(memo(), old)).rejects.toThrow(/版 1 がありません/);
    const fresh = await crypto.encrypt(memo(), 'after');
    expect(await crypto.decrypt(memo(), fresh)).toBe('after');
  });

  it('prepare は鍵の一覧の読み込みと全ての版のアンラップを先に済ませる(その後の暗号化・復号は KMS も DB も呼ばない)', async () => {
    const kms = new LocalKmsPort(KEK);
    const keys = new MemoryDataKeys();
    await keys.add(kms, 't1', 1, 'active');
    await keys.add(kms, 't1', 2, 'active');
    const crypto = new LocalCryptoPort(keys, kms, 60_000);
    let unwraps = 0;
    const unwrap = kms.unwrap.bind(kms);
    kms.unwrap = (wrapped, tenantId) => {
      unwraps++;
      return unwrap(wrapped, tenantId);
    };
    await crypto.prepare('t1');
    expect(unwraps).toBe(2);
    keys.calls = 0;
    const enc = await crypto.encrypt(memo(), 'x');
    expect(await crypto.decrypt(memo(), enc)).toBe('x');
    expect(unwraps).toBe(2);
    expect(keys.calls).toBe(0);
  });

  it('形式の違う値は明示的なエラーにする', async () => {
    const { crypto } = await setup();
    await expect(crypto.decrypt(memo(), new Uint8Array([2, 0, 1]))).rejects.toThrow(/未対応の暗号文の形式/);
  });
});

describe('LocalKmsPort(DEKのラップにテナントIDを結び付ける)', () => {
  it('別テナントとしてはアンラップできない', async () => {
    const kms = new LocalKmsPort(KEK);
    const wrapped = await kms.wrap(Buffer.alloc(32, 7), 't1');
    expect(Buffer.from(await kms.unwrap(wrapped, 't1'))).toEqual(Buffer.alloc(32, 7));
    await expect(kms.unwrap(wrapped, 't2')).rejects.toThrow();
  });
});

describe('LocalBlindIndexPort(HKDFでテナント・用途ごとの鍵を導出)', () => {
  it('同じテナント・同じ値なら同じ、テナントが違えば別の値になり、先頭1バイトが鍵の版', async () => {
    const port = new LocalBlindIndexPort('ef'.repeat(32));
    const a = await port.compute('t1', 'receipts.dedupe', '佐藤');
    expect(await port.compute('t1', 'receipts.dedupe', '佐藤')).toEqual(a);
    expect(await port.compute('t2', 'receipts.dedupe', '佐藤')).not.toEqual(a);
    expect(a).toHaveLength(33);
    expect(a[0]).toBe(1);
  });
});
