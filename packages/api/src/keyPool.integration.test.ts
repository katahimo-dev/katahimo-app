import { randomBytes } from 'node:crypto';
import { ENCRYPTION_PURPOSES, newId } from '@katahimo/core/domain';
import { provisionTenant } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, DrizzleUnitOfWork } from '@katahimo/db';
import {
  DrizzleTenantDataKeyReader,
  DrizzleTenantDirectory,
  DrizzleTenantProvisioning,
} from '@katahimo/db/repositories';
import { LocalCryptoPort, LocalKmsPort } from '@katahimo/integrations';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * 接続プールの取り合いで詰まらないこと(回帰テスト)。以前はトランザクションの中で初めて鍵が要ると、鍵の読み込みが
 * 同じプールで別のトランザクションを開こうとし、プールの大きさ以上の UoW が同時に走ると全員が空きを待ち合って止まった。
 * - UoW はトランザクションを開く前に鍵を用意する(CryptoPort.prepare)
 * - 鍵の一覧の読み直しは専用のプールで行う(トランザクションの途中で読み直しが要っても待ち合わない)
 */
const KEK = randomBytes(32).toString('hex');
const opened = [
  createDatabase(process.env.DATABASE_URL ?? '', { max: 2, onnotice: () => {} }),
  createDatabase(process.env.DATABASE_URL ?? '', { max: 1, onnotice: () => {} }),
  createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} }),
];
const [appDb, keyDb, ownerDb] = opened as [
  (typeof opened)[number],
  (typeof opened)[number],
  (typeof opened)[number],
];
afterAll(async () => {
  await Promise.all(opened.map((db) => closeDatabase(db, 1)));
});

async function newTenant(kms: LocalKmsPort): Promise<string> {
  const slug = `pool-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    {
      tenants: new DrizzleTenantDirectory(ownerDb),
      provisioning: new DrizzleTenantProvisioning(ownerDb),
      kms,
    },
    { slug, name: `プールの試験 ${slug}` },
  );
  return tenant.id;
}

/** 2本のプールで、鍵を初めて使う UoW を同時に concurrency 本走らせる。 */
async function runConcurrently(crypto: LocalCryptoPort, tenantId: string, concurrency: number) {
  const uow = new DrizzleUnitOfWork(appDb, { crypto });
  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: concurrency }, () =>
      uow.run(tenantId, async (r) => {
        const id = newId();
        const context = { tenantId, purpose: ENCRYPTION_PURPOSES.customerMemo, rowId: id };
        const enc = await crypto.encrypt(context, 'メモ');
        await r.customers.create({ id, displayName: '佐藤 花子', familyName: '佐藤', givenName: '花子' });
        return crypto.decrypt(context, enc);
      }),
    ),
  );
  return { results, elapsedMs: Date.now() - started };
}

describe('UoW と鍵の読み込み(接続プールの取り合い)', () => {
  it('鍵のキャッシュが空のまま、プールの大きさ(2)を超える UoW を同時に走らせても終わる', async () => {
    const kms = new LocalKmsPort(KEK);
    const tenantId = await newTenant(kms);
    // 鍵の読み込みも UoW と同じプール(prepare だけで詰まらないことを確かめる)
    const crypto = new LocalCryptoPort(new DrizzleTenantDataKeyReader(appDb), kms);
    const { results, elapsedMs } = await runConcurrently(crypto, tenantId, 6);
    expect(results).toEqual(Array(6).fill('メモ'));
    expect(elapsedMs).toBeLessThan(10_000);
  });

  it('トランザクションの途中で鍵の読み直しが要っても(TTL 0)、専用のプールで読むため詰まらない', async () => {
    const kms = new LocalKmsPort(KEK);
    const tenantId = await newTenant(kms);
    const crypto = new LocalCryptoPort(new DrizzleTenantDataKeyReader(keyDb), kms, 0);
    const { results, elapsedMs } = await runConcurrently(crypto, tenantId, 6);
    expect(results).toEqual(Array(6).fill('メモ'));
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
