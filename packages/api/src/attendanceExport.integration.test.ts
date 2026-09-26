import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionTenant, registerStaff, uploadReceipts } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import { type AuditLogListResponse, XLSX_CONTENT_TYPE } from '@katahimo/shared';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';

/**
 * 出勤簿の Excel の書き出し(GET /api/attendance/export ・ /export/all)を実際の DB につないで確かめる
 * (権限・テナントの分離・応答の形・中身・操作ログ・回数の上限)。テナントは毎回新しく作る。
 */
const storageDir = mkdtempSync(join(tmpdir(), 'katahimo-export-receipts-'));
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
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

interface TestTenant {
  id: string;
  slug: string;
  adminId: string;
  staffId: string;
  coordinatorId: string;
  retiredId: string;
  adminCookie: string;
  staffCookie: string;
  coordinatorCookie: string;
}

async function login(slug: string, email: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug: slug, email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function createTenant(): Promise<TestTenant> {
  const slug = `xls-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    { tenants: new DrizzleTenantDirectory(ownerDb), provisioning: new DrizzleTenantProvisioning(ownerDb) },
    { slug, name: '出勤簿の書き出し 結合テスト' },
  );
  const add = (name: string, role: 'staff' | 'coordinator' | 'admin', prefix: string) =>
    registerStaff(container, {
      tenantId: tenant.id,
      name,
      email: `${prefix}-${slug}@example.com`,
      password: PASSWORD,
      role,
    });
  const admin = await add('管理 太郎', 'admin', 'admin');
  const staff = await add('一般 花子', 'staff', 'staff');
  const coordinator = await add('調整 次郎', 'coordinator', 'coord');
  const retired = await add('退職 三郎', 'staff', 'retired');
  return {
    id: tenant.id,
    slug,
    adminId: admin.id,
    staffId: staff.id,
    coordinatorId: coordinator.id,
    retiredId: retired.id,
    adminCookie: await login(slug, `admin-${slug}@example.com`),
    staffCookie: await login(slug, `staff-${slug}@example.com`),
    coordinatorCookie: await login(slug, `coord-${slug}@example.com`),
  };
}

const get = (path: string, cookie: string) => app.request(path, { headers: { Cookie: cookie } });

async function workbookOf(res: Response): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  return workbook;
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const thisMonth = () => today().slice(0, 7);
/** 今月の日の行(4行目が1日)。 */
const rowOf = (date: string) => 3 + Number(date.slice(8, 10));

let a: TestTenant;
let b: TestTenant;

beforeAll(async () => {
  [a, b] = await Promise.all([createTenant(), createTenant()]);
  // 今月の出勤簿(1日分)と領収書(1枚)を一般スタッフに付ける
  const put = await app.request('/api/attendance/day', {
    method: 'PUT',
    headers: { Cookie: a.staffCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today(), rowData: { C: '佐藤様', D: '09:00', E: '12:00', AG: '6' } }),
  });
  expect(put.status).toBe(200);
  await uploadReceipts(
    container,
    { tenantId: a.id, staffId: a.staffId, role: 'staff' },
    {
      customerId: null,
      images: [{ data: JPEG, amount: '1,200', storeName: 'コンビニ' }],
      fallbackTimestamp: `${today().replaceAll('-', '/')} 10:00:00`,
      handoffText: '申し送り',
      customerNameText: '佐藤 様',
    },
  );
  // 月の初日に退職日を迎えた人は全員分に入らない(管理画面の退職日の設定と同じ経路)
  const retire = await app.request(`/api/admin/staff/${a.retiredId}`, {
    method: 'PATCH',
    headers: { Cookie: a.adminCookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ retiredOn: `${thisMonth()}-01` }),
  });
  expect(retire.status).toBe(200);
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
  rmSync(storageDir, { recursive: true, force: true });
});

describe('出勤簿の Excel の書き出し', () => {
  it('本人の1か月分: .xlsx・保存用の名前(RFC 5987)・no-store。中身は出勤簿の値と領収書', async () => {
    const res = await get(`/api/attendance/export?month=${thisMonth()}`, a.staffCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(XLSX_CONTENT_TYPE);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const [year, month] = thisMonth().split('-').map(Number);
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toContain(`filename="attendance_${thisMonth()}.xlsx"`);
    expect(disposition).toContain(
      `filename*=UTF-8''${encodeURIComponent(`出勤簿_${year}年${month}月_一般 花子.xlsx`)}`,
    );
    const workbook = await workbookOf(res);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([`${year}年${month}月`]);
    const ws = workbook.worksheets[0] as ExcelJS.Worksheet;
    expect(ws.getCell('H2').value).toBe('一般 花子');
    expect(ws.getCell('C2').value).toBe(`staff-${a.slug}@example.com`);
    expect(ws.getCell(`C${rowOf(today())}`).value).toBe('佐藤様');
    expect(ws.getCell(`AG${rowOf(today())}`).value).toBe(6);
    expect((ws.getCell(`AD${rowOf(today())}`).value as { formula: string }).formula).toMatch(/^ROUND\(/);
    const texts = ws
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === 'string');
    expect(texts).toEqual(expect.arrayContaining(['コンビニ', '申し送り', '佐藤 様', '領収書月集計(円)']));
  });

  it('一般スタッフが他人の staffId を送っても本人の出勤簿になる。管理者・コーディネーターは他のスタッフを選べる', async () => {
    const own = await workbookOf(
      await get(`/api/attendance/export?month=${thisMonth()}&staffId=${a.adminId}`, a.staffCookie),
    );
    expect(own.worksheets[0]?.getCell('H2').value).toBe('一般 花子');
    for (const cookie of [a.adminCookie, a.coordinatorCookie]) {
      const res = await get(`/api/attendance/export?month=${thisMonth()}&staffId=${a.staffId}`, cookie);
      expect(res.status).toBe(200);
      expect((await workbookOf(res)).worksheets[0]?.getCell('H2').value).toBe('一般 花子');
    }
  });

  it('他のテナントのスタッフは指定できない(404)', async () => {
    const res = await get(`/api/attendance/export?month=${thisMonth()}&staffId=${a.staffId}`, b.adminCookie);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'not_found' });
  });

  it('年度は12シート(4月〜3月)、名前は「<スタッフ名>_出勤簿_<年度>年度」', async () => {
    const res = await get('/api/attendance/export?fiscalYear=2026', a.staffCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(
      `filename*=UTF-8''${encodeURIComponent('一般 花子_出勤簿_2026年度.xlsx')}`,
    );
    const workbook = await workbookOf(res);
    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      '4月',
      '5月',
      '6月',
      '7月',
      '8月',
      '9月',
      '10月',
      '11月',
      '12月',
      '1月',
      '2月',
      '3月',
    ]);
  });

  it('月と年度は片方だけ(両方・どちらも無しは 400)', async () => {
    for (const q of ['', `?month=${thisMonth()}&fiscalYear=2026`, '?month=2026-13', '?fiscalYear=26']) {
      const res = await get(`/api/attendance/export${q}`, a.staffCookie);
      expect(res.status, q).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'validation_failed' });
    }
  });

  it('全員分は管理者だけ: 在籍している全員を1人1シートで。一般スタッフ・コーディネーターは 403、未ログインは 401', async () => {
    expect((await get(`/api/attendance/export/all?month=${thisMonth()}`, a.staffCookie)).status).toBe(403);
    expect((await get(`/api/attendance/export/all?month=${thisMonth()}`, a.coordinatorCookie)).status).toBe(
      403,
    );
    expect((await get(`/api/attendance/export/all?month=${thisMonth()}`, '')).status).toBe(401);

    const res = await get(`/api/attendance/export/all?month=${thisMonth()}`, a.adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(XLSX_CONTENT_TYPE);
    expect(res.headers.get('content-disposition')).toContain(`filename="attendance_${thisMonth()}_all.xlsx"`);
    const workbook = await workbookOf(res);
    expect(workbook.worksheets.map((ws) => ws.name).sort()).toEqual(
      ['一般 花子', '管理 太郎', '調整 次郎'].sort(),
    );
    const hanako = workbook.getWorksheet('一般 花子') as ExcelJS.Worksheet;
    expect(hanako.getCell(`C${rowOf(today())}`).value).toBe('佐藤様');

    // テナント B の全員分は B のスタッフだけ(同じ名前の A のスタッフの記録は入らない。RLS)
    const other = await workbookOf(
      await get(`/api/attendance/export/all?month=${thisMonth()}`, b.adminCookie),
    );
    expect(other.worksheets.map((ws) => ws.name).sort()).toEqual(
      ['一般 花子', '管理 太郎', '調整 次郎', '退職 三郎'].sort(),
    );
    expect(other.getWorksheet('一般 花子')?.getCell(`C${rowOf(today())}`).value).toBeNull();
  });

  it('書き出しは操作ログに残る(本人の分・全員分)', async () => {
    const res = await get('/api/admin/audit-logs?action=attendance.export&limit=200', a.adminCookie);
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as AuditLogListResponse).entries;
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'attendance.export.downloaded',
        'attendance.export_all.downloaded',
        'attendance.export_all.access_denied',
      ]),
    );
    expect(rows.find((r) => r.action === 'attendance.export_all.downloaded')?.details).toMatchObject({
      yearMonth: thisMonth(),
      staffCount: 3,
    });
  });

  it('回数の上限を超えると 429(Retry-After つき)', async () => {
    const limit = container.rateLimits.attendanceExportStaff.limit;
    let last: Response | null = null;
    for (let i = 0; i < limit + 1; i++)
      last = await get(`/api/attendance/export?month=${thisMonth()}`, b.staffCookie);
    expect(last?.status).toBe(429);
    expect(last?.headers.get('retry-after')).toBeTruthy();
    expect(await last?.json()).toMatchObject({ code: 'rate_limited' });
  });
});
