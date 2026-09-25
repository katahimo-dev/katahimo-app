import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzlePasswordResetCodeRepository, DrizzleRateLimiter } from '../repositories';
import type { TestTenant } from './testDatabase';
import { createTestTenant, integrationDatabaseUrl } from './testDatabase';

/**
 * 並列リクエストでの上限・1回限りの利用が、DBの条件付き更新・行ロックで守られることを実DBで確かめる
 * (セキュリティレビュー 2026-09: 41件の並列確認で attempt_count=40 になり、正しいコードが通った不具合の再発防止)。
 */
describe.skipIf(!integrationDatabaseUrl)('実DB: パスワード再設定コード・レート制限の並列性', () => {
  let t: TestTenant;
  let codes: DrizzlePasswordResetCodeRepository;
  const now = () => new Date();

  beforeAll(async () => {
    t = await createTestTenant(integrationDatabaseUrl as string);
    codes = new DrizzlePasswordResetCodeRepository(t.db);
  });
  afterAll(async () => {
    await t?.cleanup();
  });

  const issue = () =>
    codes.replaceActive(
      {
        tenantId: t.tenantId,
        staffId: t.staffId,
        codeHash: 'hash',
        sentToEmail: 'itest@example.com',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        mailCode: { ciphertext: 'v2:dummy', keyVersion: 1 },
      },
      now(),
    );

  it('並列の試行は上限(5回)までしか記録されず、それ以上は null になる', async () => {
    const code = await issue();
    const results = await Promise.all(
      Array.from({ length: 41 }, () => codes.registerAttempt(t.tenantId, code.id, 5, now())),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(5);
    expect((await codes.findById(t.tenantId, code.id))?.attemptCount).toBe(5);
  });

  it('同じコードの並列の使用は1件だけ成功し、送信待ちのコードも消える', async () => {
    const code = await issue();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => codes.consume(t.tenantId, code.id, now())),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const row = await codes.findById(t.tenantId, code.id);
    expect(row?.usedAt).not.toBeNull();
    expect(row?.mailCode).toBeNull();
    expect(await codes.registerAttempt(t.tenantId, code.id, 5, now())).toBeNull();
  });

  it('期限切れのコードは試行を記録しない', async () => {
    const code = await issue();
    expect(
      await codes.registerAttempt(t.tenantId, code.id, 5, new Date(Date.now() + 31 * 60 * 1000)),
    ).toBeNull();
  });

  it('レート制限は並列の要求でも上限回数だけ許可する(インスタンス間で共有するDBの行ロック)', async () => {
    const limiter = new DrizzleRateLimiter(t.db, 'itest-secret');
    const rule = { name: `itest_${randomUUID().slice(0, 8)}`, limit: 10, windowMs: 60_000, lockMs: 60_000 };
    const key = `198.51.100.${Math.floor(Math.random() * 250)}`;
    const decisions = await Promise.all(Array.from({ length: 30 }, () => limiter.consume(rule, key, now())));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(10);
    expect(decisions.filter((d) => d.lockStarted)).toHaveLength(1);
    expect((await limiter.peek(rule, key, now())).allowed).toBe(false);
    // キーは平文で保存しない
    const rows = await t.db.execute<{ key_hash: string }>(
      sql`SELECT key_hash FROM rate_limit_buckets WHERE bucket = ${rule.name}`,
    );
    expect(rows.map((r) => r.key_hash)).not.toContain(key);
    await limiter.reset(rule, key);
    expect((await limiter.peek(rule, key, now())).allowed).toBe(true);
  });

  it('アプリロールは tenants の更新・削除、app_logs の削除、tenant_keys の更新・削除ができない(0003)', async () => {
    for (const statement of [
      sql`UPDATE tenants SET name = name WHERE id = ${t.tenantId}`,
      sql`DELETE FROM tenants WHERE id = ${t.tenantId}`,
      sql`DELETE FROM app_logs WHERE tenant_id = ${t.tenantId}`,
      sql`UPDATE tenant_keys SET kek_version = kek_version WHERE tenant_id = ${t.tenantId}`,
      sql`DELETE FROM tenant_keys WHERE tenant_id = ${t.tenantId}`,
    ]) {
      const error = await t.db.execute(statement).then(
        () => null,
        (e: unknown) => e as Error & { cause?: Error },
      );
      // drizzle は失敗したクエリを包んだ例外にする(元のエラーは cause)
      expect(error?.cause?.message ?? error?.message).toMatch(/permission denied/);
    }
  });
});
