import { randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { receiptCancelRefusal, zonedBusinessDate } from '@katahimo/core/domain';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import type { CancelReceiptResponse, ReceiptListResponse, StaffRole } from '@katahimo/shared';
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
  id: string;
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
    id: tenant.id,
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
    expect(own.body.summary).toEqual({
      count: 2,
      totalYen: 1500,
      companyPaidYen: 0,
      customerBillableYen: 1500,
      noAmountCount: 0,
      cancelledCount: 0,
    });
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

  it('書き換えた続きの位置(UUID でない ID・範囲外の日時)は DB に渡さずに 400(500 にしない)', async () => {
    const forge = (value: unknown) =>
      encodeURIComponent(Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'));
    for (const cursor of [
      forge(['2026-09-01T00:00:00.000Z', '-'.repeat(36)]),
      forge(['275760-09-13T00:00:00.000Z', '0192f1d2-0000-7000-8000-000000000001']),
    ]) {
      const res = await get(`/api/receipts?month=2026-09&allStaff=true&cursor=${cursor}`, t.admin.cookie);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'validation_failed' });
    }
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
    expect(text.startsWith('領収書日時,スタッフ,お客様,金額(円),区分,店名')).toBe(true);
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain(
      '2026-09-20 08:00:00,山田 太郎,未登録 さん,300,お客様請求,コンビニ,駐車場代です',
    );
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

describe('API: 領収書の会社負担・取消', () => {
  // 取消せる期間は今日(日本時間)で決まるため、今日の日付の領収書を別のテナントに登録する
  let c: TestTenant;
  const today = zonedBusinessDate(new Date(), 'Asia/Tokyo');
  const todayStamp = `${today.replaceAll('-', '/')} 00:00`;
  const month = today.slice(0, 7);
  const post = (who: Member, path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { Cookie: who.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const uploadToday = async (who: Member, storeName: string, amount: string, companyPaid = false) => {
    const res = await post(who, '/api/receipts', {
      images: [{ data: JPEG, amount, storeName, receiptDate: todayStamp, companyPaid }],
    });
    expect(res.status).toBe(200);
    return (await res.json()) as { uploadedCount: number; duplicateCount: number };
  };
  /** その店名の取消していない行(一般スタッフは本人の分、管理者は全員の分から探す)。 */
  const rowOf = async (who: Member, storeName: string) => {
    const query = who === c.admin ? `month=${month}&allStaff=true` : `month=${month}`;
    const found = (await list(who, query)).body.receipts.find(
      (r) => r.storeName === storeName && r.cancellation === null,
    );
    if (!found) throw new Error(`${storeName} がありません`);
    return found;
  };

  beforeAll(async () => {
    c = await createTenant();
    await uploadToday(c.staff, 'コンビニ', '1000');
    await uploadToday(c.staff, '駐車場', '600', true);
    await uploadToday(c.other, '他人の店', '700');
  });

  it('会社負担は一覧の行・合計の内訳・CSV の区分に出る', async () => {
    const own = await list(c.staff, `month=${month}`);
    expect(own.body.receipts.find((r) => r.storeName === '駐車場')?.companyPaid).toBe(true);
    expect(own.body.receipts.find((r) => r.storeName === 'コンビニ')?.companyPaid).toBe(false);
    expect(own.body.summary).toMatchObject({
      totalYen: 1600,
      companyPaidYen: 600,
      customerBillableYen: 1000,
    });
    const csv = new TextDecoder().decode(
      await (
        await get(`/api/receipts/csv?month=${month}&staffId=${c.staff.id}`, c.admin.cookie)
      ).arrayBuffer(),
    );
    expect(csv).toContain(',600,会社負担,駐車場,');
    expect(csv).toContain(',1000,お客様請求,コンビニ,');
  });

  it('一般スタッフは他人の領収書を取消せず(403)、取消の理由は1行100文字まで(400)', async () => {
    const others = await rowOf(c.admin, '他人の店');
    expect((await post(c.staff, `/api/receipts/${others.id}/cancel`, { rowVersion: 1 })).status).toBe(403);
    const own = await rowOf(c.staff, 'コンビニ');
    const tooLong = await post(c.staff, `/api/receipts/${own.id}/cancel`, {
      reason: 'あ'.repeat(101),
      rowVersion: own.rowVersion,
    });
    expect(tooLong.status).toBe(400);
    expect((await post(c.staff, `/api/receipts/${own.id}/cancel`, {})).status).toBe(400);
    expect((await post(c.staff, '/api/receipts/not-a-uuid/cancel', { rowVersion: 1 })).status).toBe(404);
    expect(
      (await post(otherTenant.admin, `/api/receipts/${own.id}/cancel`, { rowVersion: own.rowVersion }))
        .status,
    ).toBe(404);
  });

  it('取消すと一覧に灰色で残り(取消の情報つき)、合計・CSV から外れ、同じ内容を登録し直せる', async () => {
    const own = await rowOf(c.staff, 'コンビニ');
    // 一般スタッフは月の最終日には取消せない(その日だけ 400)。管理者は取消せる
    const staffRefusal = receiptCancelRefusal({ receiptDate: today, today, role: 'staff' });
    expect(own.cancellable).toBe(staffRefusal === null);
    const actor = staffRefusal === null ? c.staff : c.admin;
    if (staffRefusal !== null) {
      const refused = await post(c.staff, `/api/receipts/${own.id}/cancel`, { rowVersion: own.rowVersion });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toMatchObject({ code: 'locked' });
    }
    const stale = await post(actor, `/api/receipts/${own.id}/cancel`, { rowVersion: own.rowVersion + 5 });
    expect(stale.status).toBe(409);
    const res = await post(actor, `/api/receipts/${own.id}/cancel`, {
      reason: ' 二重に\n撮った ',
      rowVersion: own.rowVersion,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CancelReceiptResponse;
    expect(body.receipt).toMatchObject({
      id: own.id,
      cancellable: false,
      rowVersion: own.rowVersion + 1,
      cancellation: { reason: '二重に 撮った' },
    });
    expect(
      (await post(actor, `/api/receipts/${own.id}/cancel`, { rowVersion: own.rowVersion + 1 })).status,
    ).toBe(409);

    const after = await list(c.staff, `month=${month}`);
    const cancelled = after.body.receipts.find((r) => r.id === own.id);
    expect(cancelled?.cancellation).not.toBeNull();
    expect(after.body.summary).toMatchObject({ count: 1, totalYen: 600, cancelledCount: 1 });
    const csv = new TextDecoder().decode(
      await (
        await get(`/api/receipts/csv?month=${month}&staffId=${c.staff.id}`, c.admin.cookie)
      ).arrayBuffer(),
    );
    expect(csv).not.toContain('コンビニ');
    // 取消した領収書と同じ内容は重複にならない
    expect(await uploadToday(c.staff, 'コンビニ', '1000')).toMatchObject({
      uploadedCount: 1,
      duplicateCount: 0,
    });
    expect(await uploadToday(c.staff, 'コンビニ', '1000')).toMatchObject({
      uploadedCount: 0,
      duplicateCount: 1,
    });
  });

  it('今月のまとめ・出勤簿の Excel の合計にも取消は入らず、会社負担の内訳が出る', async () => {
    const res = await get(`/api/attendance/month?month=${month}`, c.staff.cookie);
    expect(res.status).toBe(200);
    const { month: summary } = (await res.json()) as {
      month: { receipts: { total: number; companyPaid: number; customerBillable: number } };
    };
    expect(summary.receipts).toMatchObject({ total: 1600, companyPaid: 600, customerBillable: 1000 });
  });
});

describe('API: 締めた月の領収書の登録', () => {
  it('領収書日時の月の担当スタッフの出勤簿が締め済みなら 400 locked で、記録も画像も残さない', async () => {
    const fresh = await createTenant();
    await container.uow.run(fresh.id, (r) =>
      r.attendance.lockPeriod(fresh.staff.id, '2026-08', fresh.admin.id, new Date()),
    );
    const send = (who: Member, receiptDate: string, staffId?: string) =>
      app.request('/api/receipts', {
        method: 'POST',
        headers: { Cookie: who.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(staffId ? { staffId } : {}),
          customerNameText: '未登録 さん',
          images: [{ data: JPEG, amount: '800', storeName: '駐車場', receiptDate }],
        }),
      });
    const refused = await send(fresh.staff, '2026/08/31 18:00');
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      code: 'locked',
      message: expect.stringContaining('2026年8月の出勤簿は締め済み'),
    });
    // 管理者が本人の名義で登録しても同じ(締めは担当スタッフの月で見る)
    expect((await send(fresh.admin, '2026/08/31 18:00', fresh.staff.id)).status).toBe(400);
    const august = await list(fresh.admin, `month=2026-08&allStaff=true`);
    expect(august.body.receipts).toEqual([]);
    // 画像の置き場(まだ作られていなければ空): 断った登録は画像を残さない
    const receiptDir = join(storageDir, fresh.id, 'receipts');
    const storedFiles = () => readdir(receiptDir).catch(() => [] as string[]);
    expect(await storedFiles()).toEqual([]);
    // 締めていない月・締めていないスタッフは登録できる
    expect((await send(fresh.staff, '2026/09/01 09:00')).status).toBe(200);
    expect((await send(fresh.other, '2026/08/31 18:00')).status).toBe(200);
    // 同じ置き場に画像が2枚できる(上の「空」が置き場の取り違えで空だったのではない)
    expect(await storedFiles()).toHaveLength(2);
  });
});

describe('API: 領収書の登録の回数の上限', () => {
  it('スタッフ単位の1時間の上限(receipt_upload_staff)を超えたら 429(形の正しくない本文も数える。他のスタッフは登録できる)', async () => {
    const limitedEnv = loadEnv({
      ...process.env,
      NODE_ENV: 'test',
      SCHEDULE_PROVIDER: 'noop',
      MIRROR_TO_GOOGLE_SHEETS: 'false',
      STORAGE_PROVIDER: 'local',
      LOCAL_RECEIPT_STORAGE_DIR: storageDir,
      SESSION_SECRET: env.SESSION_SECRET,
      SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
      RATE_LIMIT_RECEIPT_UPLOAD_PER_STAFF_HOUR: '2',
    });
    const limitedContainer = createContainer(limitedEnv, appDb);
    expect(limitedContainer.rateLimits.receiptUploadStaff).toMatchObject({
      name: 'receipt_upload_staff',
      limit: 2,
    });
    const limitedApp = createApp({ env: limitedEnv, container: limitedContainer });
    const fresh = await createTenant();
    const send = (who: Member, amount: string) =>
      limitedApp.request('/api/receipts', {
        method: 'POST',
        headers: { Cookie: who.cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerNameText: '未登録 さん',
          images: [{ data: JPEG, amount, storeName: 'コンビニ', receiptDate: '2026/09/10 12:00' }],
        }),
      });
    expect((await send(fresh.staff, '100')).status).toBe(200);
    // 本文を読む前に数えるので、検証で断られた(400)回も1回に数える
    const invalid = await limitedApp.request('/api/receipts', {
      method: 'POST',
      headers: { Cookie: fresh.staff.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: 'not-an-array' }),
    });
    expect(invalid.status).toBe(400);
    const over = await send(fresh.staff, '300');
    expect(over.status).toBe(429);
    expect(await over.json()).toEqual({
      code: 'rate_limited',
      message: '領収書の登録の回数が上限に達しました。しばらく待ってから再度お試しください。',
    });
    expect(over.headers.get('retry-after')).not.toBeNull();
    expect((await send(fresh.other, '400')).status).toBe(200);
  });
});
