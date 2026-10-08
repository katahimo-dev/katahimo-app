import { randomBytes } from 'node:crypto';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import { NoopAiApiKeyVerifier } from '@katahimo/integrations';
import { DEMO_ACCOUNTS, DEMO_AI_USES_PER_SESSION, DEMO_PASSWORD, type DemoAccount } from '@katahimo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';
import { DEMO_AI_QUOTA_MESSAGE, DEMO_REFUSED_MESSAGE } from './http/demoRestrictions';
import { sessionCookieOf } from './testSupport/cookies';

/**
 * 公開デモ用テナント(DEMO_TENANT_SLUG)の制限を実際の DB につないで確かめる。デモ用テナントと、比べるための
 * 普通のテナントを毎回新しく作る。
 */
const demoSlug = `demo-it-${randomBytes(4).toString('hex')}`;
const otherSlug = `plain-it-${randomBytes(4).toString('hex')}`;
const baseEnv = {
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
  GEMINI_API_KEY: '',
  DEMO_TENANT_SLUG: demoSlug,
  DEMO_PUBLIC_LOGIN: '',
  DEMO_DATA_RETENTION_DAYS: '',
  DEMO_LOG_RETENTION_MONTHS: '',
};
const env = loadEnv(baseEnv);
const appDb = createDatabase(env.DATABASE_URL, { max: 4 });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
// Gemini API キーの保存の前の確認は実際の Gemini につながない(常に使えるキーとして扱う)
const container = { ...createContainer(env, appDb), aiKeyVerifier: new NoopAiApiKeyVerifier() };
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
  return sessionCookieOf(res);
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
/** 1x1 の PNG(領収書の読み取りの本文の検証を通す最小の画像)。 */
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
    // UUID を大文字で書いても同じスタッフ(DB は大文字・小文字を区別しない)なので断る
    expect((await patch(demoAdminId.toUpperCase())).status).toBe(403);
    expect((await patch(extraStaffId)).status).toBe(200);
    const del = await app.request(`/api/admin/staff/${demoAdminId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(del.status).toBe(403);
  });

  it('Google Chat の通知先の保存は 403(普通のテナントでは断らない)。Gemini の API キーは保存できる', async () => {
    const cookie = await cookieOf(demoSlug, admin.email, DEMO_PASSWORD);
    const key = await post('/api/settings/admin/gemini-key', { apiKey: 'AIza-demo' }, cookie);
    expect(key.status).toBe(200);
    const hooks = await post(
      '/api/settings/admin/gchat-webhooks',
      { reportWebhookUrl: 'https://example.com/a', receiptWebhookUrl: '' },
      cookie,
    );
    expect(hooks.status).toBe(403);
    const plain = await post('/api/settings/admin/gemini-key', { apiKey: '' }, otherAdminCookie);
    expect(plain.status).not.toBe(403);
  });
});

describe('公開デモ: 操作ログ', () => {
  it('他の訪問者の送信元IP等が残るため、デモ用テナントでは見られない(普通のテナントは見られる)', async () => {
    const cookie = await cookieOf(demoSlug, admin.email, DEMO_PASSWORD);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
    const query = `?from=${today}&to=${today}`;
    const list = await app.request(`/api/admin/audit-logs${query}`, { headers: { Cookie: cookie } });
    expect(list.status).toBe(403);
    const csv = await app.request(`/api/admin/audit-logs.csv${query}`, { headers: { Cookie: cookie } });
    expect(csv.status).toBe(403);
    const plain = await app.request(`/api/admin/audit-logs${query}`, {
      headers: { Cookie: otherAdminCookie },
    });
    expect(plain.status).toBe(200);
  });
});

describe('公開デモ: ログインと AI の回数', () => {
  it('普通のテナントでは今までどおりアカウント単位でロックする', async () => {
    const email = `locked-${otherSlug}@example.com`;
    const other = await container.tenants.findBySlug(otherSlug);
    if (!other) throw new Error('普通のテナントがありません');
    await registerStaff(container, {
      tenantId: other.id,
      name: 'ロック 三郎',
      email,
      password: OTHER_PASSWORD,
      role: 'staff',
    });
    for (let i = 0; i < 10; i++)
      expect((await loginAs(otherSlug, email, 'wrong-password-0')).status).toBe(401);
    expect((await loginAs(otherSlug, email, OTHER_PASSWORD)).status).toBe(429);
  });

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
    // 事故報告の清書・領収書の読み取りも同じ枠を使う
    const accident = await post('/api/reports/accident/generate', { text: 'メモ' }, cookie);
    expect(accident.status).toBe(429);
    const ocr = await post('/api/receipts/ocr', { image: TINY_PNG_DATA_URL }, cookie);
    expect(ocr.status).toBe(429);

    const again = await cookieOf(demoSlug, coordinator.email, DEMO_PASSWORD);
    expect((await generate(again)).status).not.toBe(429);
  });
});

describe('公開デモ: 表示の設定(GET /api/demo/config)とログイン中のスタッフの demoTenant', () => {
  const configOf = async (target: ReturnType<typeof createApp>) => {
    const res = await target.request('/api/demo/config');
    expect(res.status).toBe(200);
    return res.json();
  };
  const appWith = (overrides: Record<string, string>) => {
    const variant = loadEnv({ ...baseEnv, ...overrides });
    return createApp({ env: variant, container: createContainer(variant, appDb) });
  };

  it('ログインなしで読める。本番の環境に置くデモ(DEMO_PUBLIC_LOGIN なし)ではデモ用アカウント・パスワードを返さず、保存期間は明示したときだけ返す', async () => {
    expect(await configOf(app)).toEqual({
      enabled: true,
      tenantSlug: demoSlug,
      publicLogin: false,
      accounts: [],
      password: null,
      dataRetentionDays: null,
      logRetentionMonths: null,
      aiUsesPerSession: DEMO_AI_USES_PER_SESSION,
    });
    expect(await configOf(appWith({ DEMO_LOG_RETENTION_MONTHS: '13' }))).toMatchObject({
      publicLogin: false,
      dataRetentionDays: null,
      logRetentionMonths: 13,
    });
  });

  it('デモ専用の環境で保存期間が未設定なら 30日・12か月', async () => {
    expect(await configOf(appWith({ DEMO_PUBLIC_LOGIN: 'true' }))).toMatchObject({
      publicLogin: true,
      dataRetentionDays: 30,
      logRetentionMonths: 12,
    });
  });

  it('デモ専用の環境(DEMO_PUBLIC_LOGIN=true)ではデモ用アカウントとパスワード、保存期間の設定を返す', async () => {
    const config = await configOf(
      appWith({ DEMO_PUBLIC_LOGIN: 'true', DEMO_DATA_RETENTION_DAYS: '7', DEMO_LOG_RETENTION_MONTHS: '24' }),
    );
    expect(config).toEqual({
      enabled: true,
      tenantSlug: demoSlug,
      publicLogin: true,
      accounts: DEMO_ACCOUNTS.map(({ role, label, email }) => ({ role, label, email })),
      password: DEMO_PASSWORD,
      dataRetentionDays: 7,
      logRetentionMonths: 24,
      aiUsesPerSession: DEMO_AI_USES_PER_SESSION,
    });
  });

  it('DEMO_TENANT_SLUG が無ければ enabled: false だけ', async () => {
    expect(await configOf(appWith({ DEMO_TENANT_SLUG: '' }))).toEqual({ enabled: false });
  });

  it('ログイン・/api/auth/me の staff.demoTenant はデモ用テナントだけ true', async () => {
    const demoLogin = await loginAs(demoSlug, admin.email, DEMO_PASSWORD);
    expect(((await demoLogin.json()) as { staff: { demoTenant: boolean } }).staff.demoTenant).toBe(true);
    const demoCookie = sessionCookieOf(demoLogin);
    const me = await app.request('/api/auth/me', { headers: { Cookie: demoCookie } });
    expect(await me.json()).toMatchObject({ staff: { demoTenant: true } });

    const plainLogin = await loginAs(otherSlug, `admin-${otherSlug}@example.com`, OTHER_PASSWORD);
    expect(await plainLogin.json()).toMatchObject({ staff: { demoTenant: false } });
    const plainMe = await app.request('/api/auth/me', { headers: { Cookie: otherAdminCookie } });
    expect(await plainMe.json()).toMatchObject({ staff: { demoTenant: false } });
    // デモの設定の無い環境では、同じテナントでも false
    const noDemo = appWith({ DEMO_TENANT_SLUG: '' });
    const noDemoMe = await noDemo.request('/api/auth/me', { headers: { Cookie: demoCookie } });
    expect(await noDemoMe.json()).toMatchObject({ staff: { demoTenant: false } });
  });
});
