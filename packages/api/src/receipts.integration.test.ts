import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import type { ReceiptListResponse, StaffRole } from '@katahimo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';

/**
 * 領収書の一覧・画像・CSV の API を実際の DB とローカルのファイル置き場につないで確かめる(admin-vs-self、
 * テナントの分離、画像の応答ヘッダー)。テナントは毎回新しく作る。
 */
const storageDir = await mkdtemp(join(tmpdir(), 'katahimo-receipts-'));
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  STORAGE_PROVIDER: 'local',
  LOCAL_RECEIPT_STORAGE_DIR: storageDir,
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
});
const appDb = createDatabase(env.DATABASE_URL, { max: 4 });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
const container = createContainer(env, appDb);
const app = createApp({ env, container });

const PASSWORD = 'integration-pass-1';
/** JPEG の先頭バイト(FF D8 FF E0 …)だけの最小のデータ。 */
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

interface Member {
  id: string;
  cookie: string;
}
interface TestTenant {
  slug: string;
  staff: Member;
  other: Member;
  coordinator: Member;
  admin: Member;
}

async function createTenant(): Promise<TestTenant> {
  const slug = `rcp-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    { tenants: new DrizzleTenantDirectory(ownerDb), provisioning: new DrizzleTenantProvisioning(ownerDb) },
    { slug, name: '領収書 結合テスト' },
  );
  const member = async (key: string, name: string, role: StaffRole): Promise<Member> => {
    const email = `${key}-${slug}@example.com`;
    const staff = await registerStaff(container, {
      tenantId: tenant.id,
      name,
      email,
      password: PASSWORD,
      role,
    });
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantSlug: slug, email, password: PASSWORD }),
    });
    expect(res.status).toBe(200);
    return { id: staff.id, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  };
  return {
    slug,
    staff: await member('staff', '山田 太郎', 'staff'),
    other: await member('other', '鈴木 次郎', 'staff'),
    coordinator: await member('coord', '調整 三郎', 'coordinator'),
    admin: await member('admin', '管理 花子', 'admin'),
  };
}

const get = (path: string, cookie: string) => app.request(path, { headers: { Cookie: cookie } });
const upload = async (who: Member, amount: string, receiptDate: string) => {
  const res = await app.request('/api/receipts', {
    method: 'POST',
    headers: { Cookie: who.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerNameText: '未登録 さん',
      images: [{ data: JPEG, amount, storeName: 'コンビニ', receiptDate }],
      handoffText: '駐車場代です',
    }),
  });
  expect(res.status).toBe(200);
};
const list = async (who: Member, query: string) => {
  const res = await get(`/api/receipts?${query}`, who.cookie);
  return { status: res.status, body: (await res.json()) as ReceiptListResponse };
};

let t: TestTenant;
let otherTenant: TestTenant;

beforeAll(async () => {
  [t, otherTenant] = await Promise.all([createTenant(), createTenant()]);
  await upload(t.staff, '1200', '2026/09/10 12:00');
  await upload(t.staff, '300', '2026/09/20 08:00');
  await upload(t.staff, '999', '2026/10/01 09:00');
  await upload(t.other, '5000', '2026/09/15 09:00');
  await upload(otherTenant.staff, '7000', '2026/09/15 09:00');
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
  await rm(storageDir, { recursive: true, force: true });
});

describe('API: 領収書の一覧', () => {
  it('一般スタッフは本人の月の領収書だけ(他人の staffId は無視して本人)', async () => {
    const own = await list(t.staff, 'month=2026-09');
    expect(own.status).toBe(200);
    expect(own.body.receipts.map((r) => r.amountYen)).toEqual([300, 1200]);
    expect(own.body.summary).toEqual({ count: 2, totalYen: 1500, noAmountCount: 0 });
    expect(own.body.receipts[0]).toMatchObject({
      staffName: '山田 太郎',
      customerId: null,
      customerName: '未登録 さん',
      handoffText: '駐車場代です',
      imageContentType: 'image/jpeg',
    });
    const spoofed = await list(t.staff, `month=2026-09&staffId=${t.other.id}`);
    expect(spoofed.body.staff?.id).toBe(t.staff.id);
    expect(spoofed.body.receipts.map((r) => r.amountYen)).toEqual([300, 1200]);
  });

  it('一般スタッフの全スタッフ分・CSV は 403、未ログインは 401', async () => {
    expect((await get('/api/receipts?month=2026-09&allStaff=true', t.staff.cookie)).status).toBe(403);
    expect((await get('/api/receipts/csv?month=2026-09', t.staff.cookie)).status).toBe(403);
    expect((await app.request('/api/receipts?month=2026-09')).status).toBe(401);
    expect((await get('/api/receipts?month=2026-9', t.staff.cookie)).status).toBe(400);
  });

  it('コーディネーター・管理者は他のスタッフ・全スタッフ分を見られ、ページングできる', async () => {
    const other = await list(t.coordinator, `month=2026-09&staffId=${t.other.id}`);
    expect(other.body.receipts.map((r) => r.amountYen)).toEqual([5000]);
    const first = await list(t.admin, 'month=2026-09&allStaff=true&limit=2');
    expect(first.body.staff).toBeNull();
    expect(first.body.summary.count).toBe(3);
    expect(first.body.receipts.map((r) => r.amountYen)).toEqual([300, 5000]);
    const next = await list(
      t.admin,
      `month=2026-09&allStaff=true&limit=2&cursor=${encodeURIComponent(first.body.nextCursor ?? '')}`,
    );
    expect(next.body.receipts.map((r) => r.amountYen)).toEqual([1200]);
    expect(next.body.nextCursor).toBeNull();
  });

  it('別のテナントの領収書・スタッフは見えない(RLS)', async () => {
    const all = await list(otherTenant.admin, 'month=2026-09&allStaff=true');
    expect(all.body.receipts.map((r) => r.amountYen)).toEqual([7000]);
    expect(
      (await get(`/api/receipts?month=2026-09&staffId=${t.staff.id}`, otherTenant.admin.cookie)).status,
    ).toBe(404);
  });

  it('CSV は BOM つき UTF-8 で、条件に合う全件', async () => {
    const res = await get('/api/receipts/csv?month=2026-09&allStaff=true', t.coordinator.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('receipts_2026-09_all.csv');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder は先頭の BOM を取り除く
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('領収書日時,スタッフ,お客様,金額(円)')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('2026-09-20 08:00:00,山田 太郎,未登録 さん,300,コンビニ,駐車場代です');
  });
});

describe('API: 領収書の画像', () => {
  let ownId = '';
  let otherId = '';
  beforeAll(async () => {
    ownId = (await list(t.staff, 'month=2026-09')).body.receipts[0]?.id ?? '';
    otherId = (await list(t.admin, `month=2026-09&staffId=${t.other.id}`)).body.receipts[0]?.id ?? '';
  });

  it('本人は画像を読める(種類・キャッシュさせない・nosniff)', async () => {
    const res = await get(`/api/receipts/${ownId}/image`, t.staff.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('一般スタッフの他人の画像は 403、管理者・コーディネーターは読める', async () => {
    expect((await get(`/api/receipts/${otherId}/image`, t.staff.cookie)).status).toBe(403);
    expect((await get(`/api/receipts/${otherId}/image`, t.coordinator.cookie)).status).toBe(200);
    expect((await get(`/api/receipts/${otherId}/image`, t.admin.cookie)).status).toBe(200);
  });

  it('別のテナント・無い ID・ID でない値は 404、未ログインは 401', async () => {
    expect((await get(`/api/receipts/${ownId}/image`, otherTenant.admin.cookie)).status).toBe(404);
    expect(
      (await get('/api/receipts/0192f1d2-0000-7000-8000-000000000001/image', t.admin.cookie)).status,
    ).toBe(404);
    expect((await get('/api/receipts/not-a-uuid/image', t.admin.cookie)).status).toBe(404);
    expect((await app.request(`/api/receipts/${ownId}/image`)).status).toBe(401);
  });
});
