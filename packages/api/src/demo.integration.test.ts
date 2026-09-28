import { randomBytes } from 'node:crypto';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import { DEMO_ACCOUNTS, DEMO_AI_USES_PER_SESSION, DEMO_PASSWORD, type DemoAccount } from '@katahimo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';
import { DEMO_AI_QUOTA_MESSAGE, DEMO_REFUSED_MESSAGE } from './http/demoRestrictions';

/**
 * 公開デモ用テナント(DEMO_TENANT_SLUG)の制限を実際の DB につないで確かめる。デモ用テナントと、比べるための
 * 普通のテナントを毎回新しく作る。
 */
const demoSlug = `demo-it-${randomBytes(4).toString('hex')}`;
const otherSlug = `plain-it-${randomBytes(4).toString('hex')}`;
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
  GEMINI_API_KEY: '',
  DEMO_TENANT_SLUG: demoSlug,
});
const appDb = createDatabase(env.DATABASE_URL, { max: 4 });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
const container = createContainer(env, appDb);
const app = createApp({ env, container });

function demoAccount(role: DemoAccount['role']): DemoAccount {
  const account = DEMO_ACCOUNTS.find((a) => a.role === role);
  if (!account) throw new Error(`デモ用アカウントがありません: ${role}`);
  return account;
}
const admin = demoAccount('admin');
const OTHER_PASSWORD = 'integration-pass-1';
let demoAdminId = '';
let extraStaffId = '';
let otherAdminCookie = '';

const post = (path: string, body: unknown, cookie = '') =>
  app.request(path, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function loginAs(tenantSlug: string, email: string, password: string) {
  return post('/api/auth/login', { tenantSlug, email, password });
}

async function cookieOf(tenantSlug: string, email: string, password: string): Promise<string> {
  const res = await loginAs(tenantSlug, email, password);
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

beforeAll(async () => {
  const deps = {
    tenants: new DrizzleTenantDirectory(ownerDb),
    provisioning: new DrizzleTenantProvisioning(ownerDb),
  };
  const { tenant: demo } = await provisionTenant(deps, { slug: demoSlug, name: 'デモ 結合テスト' });
  for (const account of DEMO_ACCOUNTS) {
    const staff = await registerStaff(container, {
      tenantId: demo.id,
      name: account.name,
      email: account.email,
      password: DEMO_PASSWORD,
      role: account.role,
    });
    if (account === admin) demoAdminId = staff.id;
  }
  extraStaffId = (
    await registerStaff(container, {
      tenantId: demo.id,
      name: '追加 太郎',
      email: `extra-${demoSlug}@example.com`,
      password: DEMO_PASSWORD,
      role: 'staff',
    })
  ).id;
  const { tenant: other } = await provisionTenant(deps, { slug: otherSlug, name: '普通 結合テスト' });
  await registerStaff(container, {
    tenantId: other.id,
    name: '管理 次郎',
    email: `admin-${otherSlug}@example.com`,
    password: OTHER_PASSWORD,
    role: 'admin',
  });
  otherAdminCookie = await cookieOf(otherSlug, `admin-${otherSlug}@example.com`, OTHER_PASSWORD);
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

const refused = { code: 'forbidden', message: DEMO_REFUSED_MESSAGE };

describe('公開デモ: 断る操作', () => {
  it('パスワードの変更・再設定は 403(普通のテナントの再設定の依頼は通る)', async () => {
    const cookie = await cookieOf(demoSlug, admin.email, DEMO_PASSWORD);
    const change = await post(
      '/api/auth/change-password',
      { currentPassword: DEMO_PASSWORD, newPassword: 'changed-pass-9' },
      cookie,
    );
    expect(change.status).toBe(403);
    expect(await change.json()).toEqual(refused);
    // パスワードは変わっていない
    expect((await loginAs(demoSlug, admin.email, DEMO_PASSWORD)).status).toBe(200);

    const reset = await post('/api/auth/password-reset/request', {
      tenantSlug: demoSlug,
      email: admin.email,
    });
    expect(reset.status).toBe(403);
    const plain = await post('/api/auth/password-reset/request', {
      tenantSlug: otherSlug,
      email: `admin-${otherSlug}@example.com`,
    });
    expect(plain.status).toBe(200);
  });

  it('デモ用アカウントの変更・削除は 403、それ以外のスタッフは編集できる', async () => {
    const cookie = await cookieOf(demoSlug, admin.email, DEMO_PASSWORD);
    const patch = (id: string) =>
      app.request(`/api/admin/staff/${id}`, {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '090-0000-0000' }),
      });
    const toDemo = await patch(demoAdminId);
    expect(toDemo.status).toBe(403);
    expect(await toDemo.json()).toEqual(refused);
    expect((await patch(extraStaffId)).status).toBe(200);
    const del = await app.request(`/api/admin/staff/${demoAdminId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(del.status).toBe(403);
  });

  it('外部への送信の設定は 403(普通のテナントでは断らない)', async () => {
    const cookie = await cookieOf(demoSlug, admin.email, DEMO_PASSWORD);
    const key = await post('/api/settings/admin/gemini-key', { apiKey: 'AIza-demo' }, cookie);
    expect(key.status).toBe(403);
    const hooks = await post(
      '/api/settings/admin/gchat-webhooks',
      { reportWebhookUrl: 'https://example.com/a', receiptWebhookUrl: '' },
      cookie,
    );
    expect(hooks.status).toBe(403);
    const plain = await post(
      '/api/settings/admin/gemini-models',
      { reportModel: '', ocrModel: '' },
      otherAdminCookie,
    );
    expect(plain.status).not.toBe(403);
  });
});

describe('公開デモ: ログインと AI の回数', () => {
  it('パスワードを間違え続けてもアカウントはロックされない', async () => {
    const staff = demoAccount('staff');
    for (let i = 0; i < 12; i++) {
      expect((await loginAs(demoSlug, staff.email, 'wrong-password-0')).status).toBe(401);
    }
    expect((await loginAs(demoSlug, staff.email, DEMO_PASSWORD)).status).toBe(200);
  });

  it(`AI は1回のログインにつき ${DEMO_AI_USES_PER_SESSION} 回まで(ログインし直すと使える)`, async () => {
    const coordinator = demoAccount('coordinator');
    const generate = (cookie: string) =>
      post(
        '/api/reports/daily/generate',
        { customerId: '00000000-0000-7000-8000-000000000000', text: 'メモ' },
        cookie,
      );
    const cookie = await cookieOf(demoSlug, coordinator.email, DEMO_PASSWORD);
    for (let i = 0; i < DEMO_AI_USES_PER_SESSION; i++) {
      // 数えるのは生成の前(存在しないお客様なので 404 になる)
      expect((await generate(cookie)).status).not.toBe(429);
    }
    const over = await generate(cookie);
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({ code: 'rate_limited', message: DEMO_AI_QUOTA_MESSAGE });

    const again = await cookieOf(demoSlug, coordinator.email, DEMO_PASSWORD);
    expect((await generate(again)).status).not.toBe(429);
  });
});
