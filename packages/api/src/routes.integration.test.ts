import { randomBytes } from 'node:crypto';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';

/**
 * API のルートを実際の DB につないで app.request で確かめる(エラーの形・admin-vs-self)。
 * テナントは毎回新しく作る。
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
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
const container = createContainer(env, appDb);
const app = createApp({ env, container });

const PASSWORD = 'integration-pass-1';
let slug = '';
let staffId = '';
let adminId = '';
let staffCookie = '';
let adminCookie = '';

async function login(email: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug: slug, email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0] ?? '';
}

/** 応答の本文(テストで読む項目だけの形)。 */
type Json = { attendance: { staffId: string; staffName: string }; staff: { id: string }[] };
const json = async (res: Response) => (await res.json()) as Json;
const get = (path: string, cookie: string) => app.request(path, { headers: { Cookie: cookie } });
const send = (method: string, path: string, cookie: string, body: unknown) =>
  app.request(path, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  slug = `api-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    {
      tenants: new DrizzleTenantDirectory(ownerDb),
      provisioning: new DrizzleTenantProvisioning(ownerDb),
    },
    { slug, name: 'API 結合テスト' },
  );
  const staff = await registerStaff(container, {
    tenantId: tenant.id,
    name: '一般 花子',
    email: `staff-${slug}@example.com`,
    password: PASSWORD,
    role: 'staff',
  });
  const admin = await registerStaff(container, {
    tenantId: tenant.id,
    name: '管理 太郎',
    email: `admin-${slug}@example.com`,
    password: PASSWORD,
    role: 'admin',
  });
  staffId = staff.id;
  adminId = admin.id;
  staffCookie = await login(`staff-${slug}@example.com`);
  adminCookie = await login(`admin-${slug}@example.com`);
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

describe('API: エラーの形', () => {
  it('未ログインは 401 unauthenticated', async () => {
    const res = await get('/api/customers', '');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'unauthenticated' });
  });

  it('管理者専用は一般スタッフに 403 forbidden', async () => {
    const res = await get('/api/admin/staff', staffCookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ code: 'forbidden', message: '権限がありません。' });
  });

  it('入力の誤りは 400 validation_failed(項目名つき)', async () => {
    const res = await get('/api/attendance/day?date=2026/09/24', staffCookie);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'validation_failed',
      fields: { date: expect.any(String) },
    });
  });

  it('存在しない顧客は 404 not_found、存在しない API も 404', async () => {
    expect((await get('/api/customers/00000000-0000-7000-8000-000000000000', staffCookie)).status).toBe(404);
    expect((await get('/api/nothing', staffCookie)).status).toBe(404);
  });

  it('古い版での保存は 409 conflict、当月以外の修正は 400 locked', async () => {
    const date = today();
    const first = await send('PUT', '/api/attendance/day', staffCookie, {
      date,
      rowData: { C: '佐藤様' },
      rowVersion: 0,
    });
    expect(first.status).toBe(200);
    const stale = await send('PUT', '/api/attendance/day', staffCookie, {
      date,
      rowData: { C: '田中様' },
      rowVersion: 0,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'conflict' });
    const locked = await send('PUT', '/api/attendance/day', staffCookie, {
      date: '2020-01-01',
      rowData: { C: 'x' },
    });
    expect(locked.status).toBe(400);
    expect(await locked.json()).toMatchObject({ code: 'locked' });
  });

  it('応答にリクエストIDを付ける', async () => {
    const res = await get('/api/auth/me', staffCookie);
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await res.json()).toMatchObject({ staff: { staffId, role: 'staff' } });
  });
});

describe('API: admin-vs-self', () => {
  it('一般スタッフが他人の staffId を送っても本人の出勤簿になる', async () => {
    const res = await get(`/api/attendance/day?date=${today()}&staffId=${adminId}`, staffCookie);
    expect(res.status).toBe(200);
    expect((await json(res)).attendance.staffId).toBe(staffId);
  });

  it('管理者は staffId で他のスタッフの出勤簿を見られる', async () => {
    const res = await get(`/api/attendance/day?date=${today()}&staffId=${staffId}`, adminCookie);
    expect((await json(res)).attendance).toMatchObject({ staffId, staffName: '一般 花子' });
  });

  it('対象スタッフの選択肢は一般スタッフには空、管理者には在籍者', async () => {
    expect(await (await get('/api/staff', staffCookie)).json()).toEqual({ staff: [] });
    const admin = await json(await get('/api/staff', adminCookie));
    expect(admin.staff.map((s) => s.id).sort()).toEqual([staffId, adminId].sort());
  });
});
