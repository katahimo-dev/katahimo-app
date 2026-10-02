import { randomBytes, randomInt } from 'node:crypto';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';
import { DEVICE_COOKIE_NAME, SESSION_COOKIE_NAME } from './session';

/**
 * ログインの総当たり・締め出しの対策(アカウント・端末・送信元IP単位の回数)を実際の DB につないで確かめる。
 * テナントは毎回新しく作る。回数の上限は小さくし、送信元IPは毎回乱数で選ぶ(platform.rate_limit_buckets は
 * テナントをまたいで残るため、前の実行の回数と混ざらないように)。
 */
const ACCOUNT_LIMIT = 3;
const IP_LIMIT = 6;
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
  DEMO_TENANT_SLUG: '',
  // X-Forwarded-For の右端を送信元IPとみなす(app.request には接続元が無いため)
  TRUSTED_PROXY_HOPS: '1',
  RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT: String(ACCOUNT_LIMIT),
  RATE_LIMIT_LOGIN_FAILURES_PER_IP: String(IP_LIMIT),
});
const appDb = createDatabase(env.DATABASE_URL, { max: 4 });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
const container = createContainer(env, appDb);
const app = createApp({ env, container });
const DEVICE_LIMIT = container.rateLimits.loginFailureDevice.limit;

const PASSWORD = 'integration-pass-1';
let slug = '';
/** テストごとに別のスタッフ(アカウント単位の回数が混ざらないように)。 */
let seq = 0;

/** 送信元IP(TEST-NET-2 の中から乱数で)。 */
const randomIp = () => `198.51.${randomInt(0, 256)}.${randomInt(1, 255)}`;

interface Attempt {
  email: string;
  password: string;
  device?: string;
  ip?: string;
}

async function attempt({ email, password, device, ip = randomIp() }: Attempt) {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': ip,
      ...(device ? { Cookie: `${DEVICE_COOKIE_NAME}=${device}` } : {}),
    },
    body: JSON.stringify({ tenantSlug: slug, email, password }),
  });
  return res;
}

/** 応答の Set-Cookie から名前の値を読む。 */
function cookieValue(res: Response, name: string): string | null {
  for (const line of res.headers.getSetCookie()) {
    const [pair = ''] = line.split(';');
    const idx = pair.indexOf('=');
    if (pair.slice(0, idx) === name) return pair.slice(idx + 1);
  }
  return null;
}

async function newStaff(): Promise<string> {
  seq++;
  const email = `staff${seq}-${slug}@example.com`;
  const tenant = await container.tenants.findBySlug(slug);
  if (!tenant) throw new Error('テナントがありません');
  await registerStaff(container, {
    tenantId: tenant.id,
    name: `スタッフ ${seq}`,
    email,
    password: PASSWORD,
    role: 'staff',
  });
  return email;
}

/** ログインして「この端末」の印を受け取る。 */
async function deviceOf(email: string): Promise<string> {
  const res = await attempt({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  const device = cookieValue(res, DEVICE_COOKIE_NAME);
  if (!device) throw new Error('端末の印がありません');
  return decodeURIComponent(device);
}

async function lockAccount(email: string) {
  for (let i = 0; i < ACCOUNT_LIMIT; i++) {
    expect((await attempt({ email, password: 'wrong-password' })).status).toBe(401);
  }
  expect((await attempt({ email, password: PASSWORD })).status).toBe(429);
}

beforeAll(async () => {
  slug = `auth-${randomBytes(4).toString('hex')}`;
  await provisionTenant(
    {
      tenants: new DrizzleTenantDirectory(ownerDb),
      provisioning: new DrizzleTenantProvisioning(ownerDb),
    },
    { slug, name: 'ログイン 結合テスト' },
  );
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

describe('API: ログインの「この端末」の印', () => {
  it('ログインの成功でセッションの Cookie の後に、HttpOnly・SameSite=Lax・180日の端末の Cookie を置く', async () => {
    const email = await newStaff();
    const res = await attempt({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const lines = res.headers.getSetCookie();
    expect(lines[0]?.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);
    const device = lines.find((l) => l.startsWith(`${DEVICE_COOKIE_NAME}=`)) ?? '';
    expect(device).toMatch(/HttpOnly/);
    expect(device).toMatch(/SameSite=Lax/);
    expect(device).toMatch(/Path=\//);
    const maxAge = Number(/Max-Age=(\d+)/.exec(device)?.[1]);
    expect(maxAge).toBeGreaterThan(180 * 24 * 60 * 60 - 60);
    expect(maxAge).toBeLessThanOrEqual(180 * 24 * 60 * 60);
    expect(device).not.toContain(encodeURIComponent(email));
  });

  it('ログアウトでは端末の Cookie を消さない', async () => {
    const email = await newStaff();
    const res = await attempt({ email, password: PASSWORD });
    const session = cookieValue(res, SESSION_COOKIE_NAME) ?? '';
    const out = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${session}` },
    });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().some((l) => l.startsWith(`${DEVICE_COOKIE_NAME}=`))).toBe(false);
  });

  it('アカウントがロック中でも、正しい端末の Cookie と正しいパスワードなら 200', async () => {
    const email = await newStaff();
    const device = await deviceOf(email);
    await lockAccount(email);
    const res = await attempt({ email, password: PASSWORD, device });
    expect(res.status).toBe(200);
    // 端末の印は発行し直す
    expect(cookieValue(res, DEVICE_COOKIE_NAME)).not.toBeNull();
    // 印の無い要求は引き続きロック中
    expect((await attempt({ email, password: PASSWORD })).status).toBe(429);
  });

  it('端末の Cookie つきの誤ったパスワードは端末単位で数え、アカウント単位には数えない', async () => {
    const email = await newStaff();
    const device = await deviceOf(email);
    for (let i = 0; i < DEVICE_LIMIT; i++) {
      expect((await attempt({ email, password: 'wrong-password', device })).status).toBe(401);
    }
    // 端末単位の上限でその端末はロック(正しいパスワードでも)
    expect((await attempt({ email, password: PASSWORD, device })).status).toBe(429);
    // アカウント単位は減っていない(上限の回数より多く失敗した後でも、印の無い要求で通る)
    expect(DEVICE_LIMIT).toBeGreaterThan(ACCOUNT_LIMIT);
    expect((await attempt({ email, password: PASSWORD })).status).toBe(200);
  });

  it('別のアカウントの端末の Cookie・書き換えた Cookie は使えない(ロック中は 429 のまま)', async () => {
    const email = await newStaff();
    const other = await newStaff();
    const own = await deviceOf(email);
    const othersDevice = await deviceOf(other);
    await lockAccount(email);
    expect((await attempt({ email, password: PASSWORD, device: othersDevice })).status).toBe(429);
    const forged = `${own.slice(0, -2)}${own.endsWith('AA') ? 'BB' : 'AA'}`;
    expect((await attempt({ email, password: PASSWORD, device: forged })).status).toBe(429);
    expect((await attempt({ email, password: PASSWORD, device: 'v1.garbage' })).status).toBe(429);
  });

  it('パスワードを変えると、前の端末の Cookie ではロックを避けられない', async () => {
    const email = await newStaff();
    const res = await attempt({ email, password: PASSWORD });
    const device = decodeURIComponent(cookieValue(res, DEVICE_COOKIE_NAME) ?? '');
    const session = cookieValue(res, SESSION_COOKIE_NAME) ?? '';
    const changed = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${session}` },
      body: JSON.stringify({ currentPassword: PASSWORD, newPassword: 'changed-pass-1' }),
    });
    expect(changed.status).toBe(200);
    for (let i = 0; i < ACCOUNT_LIMIT; i++) await attempt({ email, password: 'wrong-password' });
    expect((await attempt({ email, password: 'changed-pass-1', device })).status).toBe(429);
  });

  it('送信元IPでロック中の要求はアカウント単位の回数に数えない', async () => {
    const email = await newStaff();
    const ip = randomIp();
    // 別のアカウント(無いアカウント)への試行で、この送信元IPをロックする
    for (let i = 0; i < IP_LIMIT; i++) {
      await attempt({ email: `nobody${i}-${slug}@example.com`, password: 'guess', ip });
    }
    for (let i = 0; i < ACCOUNT_LIMIT * 2; i++) {
      expect((await attempt({ email, password: 'wrong-password', ip })).status).toBe(429);
    }
    // 別の送信元IPの本人は締め出されない
    expect((await attempt({ email, password: PASSWORD })).status).toBe(200);
  });
});

describe('API: パスワード変更の現在のパスワードの誤り', () => {
  const changePassword = (session: string, currentPassword: string, newPassword = 'changed-pass-2') =>
    app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE_NAME}=${session}` },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

  it('スタッフ単位の上限を超えると正しいパスワードでも 429(Retry-After つき)、成功すると端末の印を作り直す', async () => {
    const email = await newStaff();
    const res = await attempt({ email, password: PASSWORD });
    const session = cookieValue(res, SESSION_COOKIE_NAME) ?? '';
    const limit = container.rateLimits.passwordChangeFailureStaff.limit;
    for (let i = 0; i < limit; i++) {
      const wrong = await changePassword(session, 'wrong-password');
      expect(wrong.status).toBe(400);
    }
    const locked = await changePassword(session, PASSWORD);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await locked.json()) as { message: string }).message).toContain(
      '一時的にパスワードを変更できません',
    );

    // 別のスタッフは影響を受けず、成功すると端末の印の Cookie を返す
    const other = await newStaff();
    const otherSession =
      cookieValue(await attempt({ email: other, password: PASSWORD }), SESSION_COOKIE_NAME) ?? '';
    const ok = await changePassword(otherSession, PASSWORD);
    expect(ok.status).toBe(200);
    expect(cookieValue(ok, DEVICE_COOKIE_NAME)).not.toBeNull();
  });
});
