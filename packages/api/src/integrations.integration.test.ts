import { randomBytes } from 'node:crypto';
import {
  createIntegrationApiKey,
  provisionTenant,
  registerStaff,
  revokeIntegrationApiKey,
} from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, DrizzleUnitOfWork, withTenant } from '@katahimo/db';
import {
  DrizzleAppLogRepository,
  DrizzleTenantDirectory,
  DrizzleTenantProvisioning,
} from '@katahimo/db/repositories';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';
import { sessionCookieOf } from './testSupport/cookies';

/**
 * 外部システムからの顧客の受け取り(POST /api/integrations/customers)を実際の DB で確かめる:
 * API キーの認証(Cookie は使わない・失効・別のテナント)、1トランザクションでの取込、本体の大きさ・回数の上限、
 * キーの発行・失効が運用担当者(所有者の接続)だけにできること。
 */
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
});
const appDb = createDatabase(env.DATABASE_URL, { max: 4 });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 2, onnotice: () => {} });
const container = createContainer(env, appDb);
const app = createApp({ env, container });
const tenants = new DrizzleTenantDirectory(ownerDb);
/** 運用担当者の CLI(`pnpm tenant:api-keys`)と同じ依存(所有者の接続)。 */
const operator = {
  tenants,
  uow: new DrizzleUnitOfWork(ownerDb),
  appLog: new DrizzleAppLogRepository(ownerDb),
};

let slug = '';
let tenantId = '';
let token = '';
let apiKeyId = '';
let adminCookie = '';

const post = (body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${token}` }) =>
  app.request('/api/integrations/customers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function createTenant(prefix: string) {
  const { tenant } = await provisionTenant(
    { tenants, provisioning: new DrizzleTenantProvisioning(ownerDb) },
    { slug: `${prefix}-${randomBytes(4).toString('hex')}`, name: '外部連携の結合テスト' },
  );
  return tenant;
}

beforeAll(async () => {
  const tenant = await createTenant('int');
  slug = tenant.slug;
  tenantId = tenant.id;
  const created = await createIntegrationApiKey(operator, slug, {
    name: 'RESERVA 結合テスト',
    customerSource: 'external_api',
    createdBy: 'integration-test',
  });
  token = created.token;
  apiKeyId = created.key.id;
  await registerStaff(container, {
    tenantId,
    name: '管理 太郎',
    email: `admin-${slug}@example.com`,
    password: 'integration-pass-1',
    role: 'admin',
  });
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantSlug: slug,
      email: `admin-${slug}@example.com`,
      password: 'integration-pass-1',
    }),
  });
  adminCookie = sessionCookieOf(login);
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

const customer = (externalId: string, extra: Record<string, unknown> = {}) => ({
  externalId,
  familyName: '佐藤',
  givenName: '花子',
  home: { addressLine: '東京都世田谷区用賀4-1-1', lat: 35.6264, lng: 139.6336 },
  recipients: [{ name: '佐藤 一郎', birthDate: '2020-04-01' }],
  ...extra,
});

describe('API: 外部システムからの顧客の受け取り', () => {
  it('API キーで顧客を作成・更新し、1件ごとの結果と import_runs を返す。画面の顧客一覧にも出る', async () => {
    const res = await post({ customers: [customer('EXT-1'), customer('EXT-2')] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      importRunId: string;
      counts: Record<string, number>;
      results: unknown[];
    };
    expect(body.counts).toEqual({ created: 2, updated: 0, unchanged: 0, skipped: 0 });
    expect(body.results).toEqual([
      { externalId: 'EXT-1', outcome: 'created', issues: [] },
      { externalId: 'EXT-2', outcome: 'created', issues: [] },
    ]);
    const again = await post({
      customers: [customer('EXT-1', { phone: '090-1234-5678' }), customer('EXT-2')],
    });
    expect(((await again.json()) as { counts: unknown }).counts).toEqual({
      created: 0,
      updated: 1,
      unchanged: 1,
      skipped: 0,
    });

    const run = await withTenant(appDb, tenantId, (tx) =>
      tx.execute(sql`select source, status, counts from import_runs where id = ${body.importRunId}`),
    );
    expect(run[0]).toMatchObject({ source: 'external_api', status: 'applied' });
    const list = await app.request('/api/customers', { headers: { Cookie: adminCookie } });
    const names = ((await list.json()) as { customers: { name: string }[] }).customers.map((c) => c.name);
    expect(names).toContain('佐藤 花子');
    const key = await withTenant(ownerDb, tenantId, (tx) =>
      tx.execute(sql`select last_used_at from integration_api_keys where id = ${apiKeyId}`),
    );
    expect(key[0]?.last_used_at).not.toBeNull();
  });

  it('同じ新しい顧客IDを同時に送っても顧客は1人だけ(テナントの取込のロックで1つずつ適用する)', async () => {
    const countCustomers = async () =>
      (
        await withTenant(appDb, tenantId, (tx) => tx.execute(sql`select count(*)::int as n from customers`))
      )[0]?.n as number;
    const before = await countCustomers();
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => post({ customers: [customer('RACE-1'), customer('RACE-2')] })),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as {
      counts: Record<string, number>;
    }[];
    expect(bodies.map((b) => b.counts.created).sort()).toEqual([0, 0, 2]);
    expect(await countCustomers()).toBe(before + 2);
    const linked = await withTenant(appDb, tenantId, (tx) =>
      tx.execute(
        sql`select count(*)::int as n from customer_source_records
            where source = 'external_api' and external_id in ('RACE-1', 'RACE-2')`,
      ),
    );
    expect(linked[0]?.n).toBe(2);
  });

  it('他の取込がロックを lock_timeout(5秒)より長く持っていれば 409 と送り直しの案内(500 にしない)。放した後は通る', async () => {
    let release = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = () => {};
    const lockTaken = new Promise<void>((resolve) => {
      locked = resolve;
    });
    // 別の接続で、夜間の顧客CSVの取込と同じテナントの取込のロックを持ち続ける
    const holder = ownerDb.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`customer_import:${tenantId}`}, 0))`,
      );
      locked();
      await released;
    });
    try {
      await lockTaken;
      const res = await post({ customers: [customer('BUSY-1')] });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        code: 'conflict',
        message: '別の顧客の取込が実行中です。しばらくしてから送り直してください。',
      });
      const failed = await withTenant(ownerDb, tenantId, (tx) =>
        tx.execute(
          sql`select level, details from app_logs
              where action = 'integration.customers.ingest_failed' order by created_at desc limit 1`,
        ),
      );
      expect(failed[0]).toMatchObject({
        level: 'WARN',
        details: expect.objectContaining({ error: 'conflict:customer_import_in_progress' }),
      });
    } finally {
      release();
      await holder;
    }
    const retried = await post({ customers: [customer('BUSY-1')] });
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { counts: { created: number } }).counts.created).toBe(1);
  }, 30_000);

  it('キーが無い・Cookie のセッションだけ・形が違う・別のテナントのIDに差し替えたキーは 401', async () => {
    const other = await createTenant('int-other');
    const forged = token.replace(tenantId.replaceAll('-', ''), other.id.replaceAll('-', ''));
    for (const headers of [
      {} as Record<string, string>,
      { Cookie: adminCookie },
      { Authorization: token },
      { Authorization: `Bearer ${token}x` },
      { Authorization: `Bearer ${forged}` },
    ]) {
      const res = await post({ customers: [customer('EXT-X')] }, headers);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(await res.json()).toMatchObject({ code: 'unauthenticated' });
    }
    const count = await withTenant(appDb, other.id, (tx) =>
      tx.execute(sql`select count(*)::int as n from customers`),
    );
    expect(count[0]?.n).toBe(0);
  });

  it('本文の誤りは 400(1件も書かない)、2MB を超える本文は 413、既定の 256KB は超えてよい', async () => {
    const invalid = await post({ customers: [customer('EXT-3'), customer('EXT-3')] });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'validation_failed' });

    const memo = 'あ'.repeat(1500);
    const large = await post({
      customers: Array.from({ length: 80 }, (_, i) => customer(`BIG-${i}`, { memo })),
    });
    expect(large.status).toBe(200);
    const tooLarge = await post(JSON.stringify({ customers: [], padding: 'x'.repeat(2 * 1024 * 1024 + 1) }));
    expect(tooLarge.status).toBe(413);
  });

  it('キー単位の1時間の回数の上限で 429', async () => {
    const limitedApp = createApp({
      env,
      container: {
        ...container,
        rateLimits: {
          ...container.rateLimits,
          integrationCustomersKey: {
            name: `integration_customers_key_it_${slug}`,
            limit: 1,
            windowMs: 3600_000,
          },
        },
      },
    });
    const send = () =>
      limitedApp.request('/api/integrations/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ customers: [customer('EXT-1')] }),
      });
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).not.toBeNull();
  });

  it('同じ送信元IPの認証の失敗が続くと 429(ロック中は正しいキーも確かめない。別の送信元IPは通る)', async () => {
    const lockedApp = createApp({
      env: { ...env, TRUSTED_PROXY_HOPS: 1 },
      container: {
        ...container,
        rateLimits: {
          ...container.rateLimits,
          integrationAuthFailureIp: {
            name: `integration_auth_failure_ip_it_${slug}`,
            limit: 2,
            windowMs: 60_000,
            lockMs: 60_000,
          },
        },
      },
    });
    const send = (bearer: string, ip: string) =>
      lockedApp.request('/api/integrations/customers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
          'X-Forwarded-For': ip,
        },
        body: JSON.stringify({ customers: [customer('EXT-1')] }),
      });
    const ip = `198.51.100.${randomBytes(1)[0]}`;
    expect((await send(`${token}x`, ip)).status).toBe(401);
    expect((await send(`${token}x`, ip)).status).toBe(401);
    const locked = await send(`${token}x`, ip);
    expect(locked.status).toBe(429);
    expect(locked.headers.get('retry-after')).not.toBeNull();
    expect(await locked.json()).toMatchObject({ code: 'rate_limited' });
    expect((await send(token, ip)).status).toBe(429);
    expect((await send(token, '192.0.2.1')).status).toBe(200);
  });

  it('失効させたキーは 401。アプリのロールはキーを作れない・失効させられない', async () => {
    const { key, token: revokedToken } = await createIntegrationApiKey(operator, slug, {
      name: '失効させるキー',
      customerSource: 'reserva',
      createdBy: 'integration-test',
    });
    await revokeIntegrationApiKey(operator, slug, key.id);
    const res = await post({ customers: [customer('EXT-9')] }, { Authorization: `Bearer ${revokedToken}` });
    expect(res.status).toBe(401);

    await expect(
      withTenant(appDb, tenantId, (tx) =>
        tx.execute(
          sql`insert into integration_api_keys (tenant_id, name, customer_source, token_hash, created_by)
              values (${tenantId}, 'x', 'reserva', '\\x00', 'app')`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(appDb, tenantId, (tx) =>
        tx.execute(sql`update integration_api_keys set revoked_at = null where id = ${key.id}`),
      ),
    ).rejects.toThrow();
  });
});
