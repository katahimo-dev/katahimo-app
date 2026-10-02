import { randomBytes } from 'node:crypto';
import { newId } from '@katahimo/core/domain';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import type { AuditLogListResponse, ReportDetailResponse, ReportListResponse } from '@katahimo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';
import { sessionCookieOf } from './testSupport/cookies';

/**
 * 全員分の日報・事故報告の一覧・詳細・CSV の API を実際の DB につないで確かめる(役割ごとの権限、
 * テナントの分離(RLS)、keyset ページング、CSV)。テナントは毎回新しく作る。
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

interface TestTenant {
  id: string;
  slug: string;
  staffId: string;
  otherId: string;
  coordinatorId: string;
  customerId: string;
  staffCookie: string;
  otherCookie: string;
  coordinatorCookie: string;
  adminCookie: string;
}

async function login(slug: string, email: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug: slug, email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return sessionCookieOf(res);
}

const get = (path: string, cookie: string) => app.request(path, { headers: { Cookie: cookie } });
const post = (path: string, cookie: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function createTenant(): Promise<TestTenant> {
  const slug = `rep-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    { tenants: new DrizzleTenantDirectory(ownerDb), provisioning: new DrizzleTenantProvisioning(ownerDb) },
    { slug, name: '報告一覧 結合テスト' },
  );
  const register = (name: string, email: string, role: 'staff' | 'coordinator' | 'admin') =>
    registerStaff(container, { tenantId: tenant.id, name, email, password: PASSWORD, role });
  const staff = await register('一般 花子', `staff-${slug}@example.com`, 'staff');
  const other = await register('一般 次郎', `other-${slug}@example.com`, 'staff');
  const coordinator = await register('調整 役', `coord-${slug}@example.com`, 'coordinator');
  await register('管理 太郎', `admin-${slug}@example.com`, 'admin');
  const customerId = await container.uow.run(tenant.id, (r) =>
    r.customers
      .create({ id: newId(), displayName: '佐藤 はな', familyName: '佐藤', givenName: 'はな' })
      .then((c) => c.id),
  );
  return {
    id: tenant.id,
    slug,
    staffId: staff.id,
    otherId: other.id,
    coordinatorId: coordinator.id,
    customerId,
    staffCookie: await login(slug, `staff-${slug}@example.com`),
    otherCookie: await login(slug, `other-${slug}@example.com`),
    coordinatorCookie: await login(slug, `coord-${slug}@example.com`),
    adminCookie: await login(slug, `admin-${slug}@example.com`),
  };
}

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

async function saveDaily(t: TestTenant, cookie: string, inputText: string, reportDate = today()) {
  const res = await post('/api/reports/daily', cookie, {
    customerId: t.customerId,
    reportDate,
    startTime: '09:00',
    endTime: '12:00',
    inputText,
    internalText: `社内向け ${inputText}`,
    customerText: '保護者向け',
    riskRating: 2,
    esRating: 4,
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { report: { id: string } }).report.id;
}

let t: TestTenant;
let other: TestTenant;
let staffReportId = '';
let otherReportId = '';

beforeAll(async () => {
  [t, other] = await Promise.all([createTenant(), createTenant()]);
  staffReportId = await saveDaily(t, t.staffCookie, 'はなさんと公園');
  otherReportId = await saveDaily(t, t.otherCookie, '次郎の日報');
  const accident = await post('/api/reports/accident', t.otherCookie, {
    customerId: t.customerId,
    reportType: 'ヒヤリハット',
    location: '公園',
    accidentContent: '転びそうになった',
    inputText: 'ヒヤッとした',
  });
  expect(accident.status).toBe(200);
  // 別テナントの記録(見えてはいけない)
  await saveDaily(other, other.staffCookie, '別テナントの日報');
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

describe('API: 日報・事故報告の一覧', () => {
  it('コーディネーターは全員分を新しい順に見られ、別テナントの記録は出ない', async () => {
    const res = await get('/api/reports', t.coordinatorCookie);
    expect(res.status).toBe(200);
    const page = (await res.json()) as ReportListResponse;
    expect(page.timeZone).toBe('Asia/Tokyo');
    expect(page.range.to).toBe(today());
    expect(page.reports.map((r) => r.kind).sort()).toEqual(['daily_report', 'daily_report', 'near_miss']);
    expect(page.reports.every((r) => r.customerName === '佐藤 はな')).toBe(true);
    expect(page.reports.some((r) => r.excerpt.includes('別テナント'))).toBe(false);
    const daily = page.reports.find((r) => r.id === staffReportId);
    expect(daily).toMatchObject({
      staffName: '一般 花子',
      time: '09:00〜12:00',
      excerpt: '社内向け はなさんと公園',
      riskRating: 2,
      esRating: 4,
    });
    const times = page.reports.map((r) => r.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('絞り込み(スタッフ・種類)が効き、keyset ページングで重複なく続きを読める', async () => {
    const byStaff = (await (
      await get(`/api/reports?staffId=${t.otherId}`, t.coordinatorCookie)
    ).json()) as ReportListResponse;
    expect(byStaff.reports.every((r) => r.staffId === t.otherId)).toBe(true);
    expect(byStaff.reports).toHaveLength(2);
    const nearMiss = (await (
      await get('/api/reports?kind=near_miss', t.adminCookie)
    ).json()) as ReportListResponse;
    expect(nearMiss.reports.map((r) => r.kind)).toEqual(['near_miss']);

    const first = (await (
      await get('/api/reports?limit=2', t.coordinatorCookie)
    ).json()) as ReportListResponse;
    expect(first.reports).toHaveLength(2);
    const second = (await (
      await get(
        `/api/reports?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        t.coordinatorCookie,
      )
    ).json()) as ReportListResponse;
    expect(second.nextCursor).toBeNull();
    const ids = [...first.reports, ...second.reports].map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('sort=saved は最初に保存した順(上書き保存しても順は変わらない)。続きの位置はマイクロ秒まで保ち、別の並びの位置は 400', async () => {
    // 上書き保存(同じ内容)。同じ記録が直るだけで、新しい記録にはならない
    const overwrite = await post('/api/reports/daily', t.otherCookie, {
      reportId: otherReportId,
      customerId: t.customerId,
      reportDate: today(),
      startTime: '09:00',
      endTime: '12:00',
      inputText: '次郎の日報',
      internalText: '社内向け 次郎の日報',
      customerText: '保護者向け',
      riskRating: 2,
      esRating: 4,
    });
    expect(overwrite.status).toBe(200);
    const all = (await (
      await get('/api/reports?sort=saved', t.coordinatorCookie)
    ).json()) as ReportListResponse;
    const accidentId = all.reports.find((r) => r.kind === 'near_miss')?.id;
    expect(all.reports.map((r) => r.id)).toEqual([accidentId, otherReportId, staffReportId]);
    const createdAts = all.reports.map((r) => r.createdAt);
    expect([...createdAts].sort().reverse()).toEqual(createdAts);

    const seen: string[] = [];
    let cursor = '';
    let savedCursor = '';
    for (let n = 0; n < 4; n++) {
      const page = (await (
        await get(
          `/api/reports?sort=saved&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
          t.coordinatorCookie,
        )
      ).json()) as ReportListResponse;
      seen.push(...page.reports.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      savedCursor ||= page.nextCursor;
    }
    expect(seen).toEqual([accidentId, otherReportId, staffReportId]);

    const occurred = (await (
      await get('/api/reports?limit=1', t.coordinatorCookie)
    ).json()) as ReportListResponse;
    for (const path of [
      `/api/reports?sort=saved&cursor=${encodeURIComponent(occurred.nextCursor ?? '')}`,
      `/api/reports?cursor=${encodeURIComponent(savedCursor)}`,
      '/api/reports?sort=newest',
    ]) {
      expect((await get(path, t.coordinatorCookie)).status, path).toBe(400);
    }
  });

  it('書き換えた続きの位置(UUID でない ID・範囲外の日時)は一覧・これまでの記録・操作ログとも 400(500 にしない)', async () => {
    const forge = (value: unknown) =>
      encodeURIComponent(Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'));
    const badId = forge(['2026-09-01T00:00:00.000Z', '-'.repeat(36)]);
    const badDate = forge(['275760-09-13T00:00:00.000Z', '0192f1d2-0000-7000-8000-000000000001']);
    for (const path of [
      `/api/reports?cursor=${badId}`,
      `/api/reports?cursor=${badDate}`,
      `/api/reports/history?customerId=${t.customerId}&before=${badId}`,
      `/api/reports/history?customerId=${t.customerId}&before=${badDate}`,
      `/api/admin/audit-logs?cursor=${badId}`,
      `/api/admin/audit-logs?cursor=${badDate}`,
    ]) {
      const res = await get(path, t.adminCookie);
      expect(res.status, path).toBe(400);
    }
  });

  it('年の端(0001年・9999年)の続きの位置は DB に渡しても 500 にならない(0000年は 400)', async () => {
    const forge = (value: unknown) =>
      encodeURIComponent(Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'));
    const id = '0192f1d2-0000-7000-8000-000000000001';
    for (const at of ['0001-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) {
      const cursor = forge([at, id]);
      for (const path of [
        `/api/reports?cursor=${cursor}`,
        `/api/reports/history?customerId=${t.customerId}&before=${cursor}`,
        `/api/admin/audit-logs?cursor=${cursor}`,
      ]) {
        const res = await get(path, t.adminCookie);
        expect(res.status, `${path} ${at}`).toBe(200);
      }
    }
    const yearZero = forge(['0000-01-01T00:00:00.000Z', id]);
    expect((await get(`/api/reports?cursor=${yearZero}`, t.adminCookie)).status).toBe(400);
  });

  it('日報の訪問日は実在する 2000〜2100年の日付だけ(400)', async () => {
    for (const reportDate of ['1999-12-31', '2101-01-01', '2026-02-30', '0001-01-01']) {
      const res = await post('/api/reports/daily', t.adminCookie, {
        customerId: t.customerId,
        reportDate,
        startTime: '09:00',
        endTime: '10:00',
      });
      expect(res.status, reportDate).toBe(400);
      expect(await res.json()).toMatchObject({
        code: 'validation_failed',
        fields: { reportDate: expect.any(String) },
      });
    }
  });

  it('一般スタッフは staffId を送っても本人の記録だけ', async () => {
    const page = (await (
      await get(`/api/reports?staffId=${t.otherId}`, t.staffCookie)
    ).json()) as ReportListResponse;
    expect(page.reports.map((r) => r.id)).toEqual([staffReportId]);
  });

  it('条件の誤り(期間の逆転・長すぎる期間・種類)は 400、未ログインは 401', async () => {
    const reversed = await get('/api/reports?from=2026-09-10&to=2026-09-01', t.coordinatorCookie);
    expect(reversed.status).toBe(400);
    expect(await reversed.json()).toMatchObject({
      code: 'validation_failed',
      fields: { from: expect.any(String) },
    });
    expect((await get('/api/reports?from=2024-01-01&to=2026-09-01', t.coordinatorCookie)).status).toBe(400);
    expect((await get('/api/reports?kind=other', t.coordinatorCookie)).status).toBe(400);
    expect((await get('/api/reports', '')).status).toBe(401);
  });

  it('詳細: コーディネーターは他のスタッフの記録を読めて記録が残る。一般スタッフは本人の記録だけ', async () => {
    const res = await get(`/api/reports/${staffReportId}`, t.coordinatorCookie);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as ReportDetailResponse;
    expect(detail.report).toMatchObject({
      kind: 'daily_report',
      staffName: '一般 花子',
      revisionCount: 0,
      content: { inputText: 'はなさんと公園', customerText: '保護者向け' },
    });
    expect((await get(`/api/reports/${staffReportId}`, t.staffCookie)).status).toBe(200);
    expect((await get(`/api/reports/${otherReportId}`, t.staffCookie)).status).toBe(403);
    // 別テナントの管理者からは存在しない記録と同じ
    const otherAdmin = await login(other.slug, `admin-${other.slug}@example.com`);
    expect((await get(`/api/reports/${staffReportId}`, otherAdmin)).status).toBe(404);
    expect((await get('/api/reports/not-a-uuid', t.coordinatorCookie)).status).toBe(404);
  });

  it('CSV: コーディネーターは BOM つき UTF-8 で書き出せ、書き出しを記録する。一般スタッフは 403', async () => {
    const res = await get('/api/reports/export.csv?sheet=daily', t.coordinatorCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="reports-daily_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const [header, ...rows] = new TextDecoder().decode(bytes.slice(3)).trimEnd().split('\r\n');
    expect(header).toBe(
      '日時,開始時刻,終了時刻,スタッフ,顧客ID,お客様,書いたメモ,事務局に送る文,保護者に送る文,PSI,ES,記録ID,最終更新',
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.includes(',佐藤 はな,') && r.includes(',09:00,12:00,'))).toBe(true);

    const accident = await get('/api/reports/export.csv?sheet=accident', t.adminCookie);
    const accidentRows = (await accident.text()).trimEnd().split('\r\n');
    expect(accidentRows).toHaveLength(2);
    expect(accidentRows[1]).toContain(',ヒヤリハット,');

    // sort=saved は保存した順(次郎の日報を後から保存した)
    const saved = await get('/api/reports/export.csv?sheet=daily&sort=saved', t.adminCookie);
    const savedRows = (await saved.text()).trimEnd().split('\r\n').slice(1);
    expect(savedRows).toHaveLength(2);
    expect(savedRows[0]).toContain('次郎の日報');
    expect(savedRows[1]).toContain('はなさんと公園');

    expect((await get('/api/reports/export.csv?sheet=daily', t.staffCookie)).status).toBe(403);
    expect((await get('/api/reports/export.csv', t.coordinatorCookie)).status).toBe(400);
    expect((await get('/api/reports/export.csv?sheet=daily&kind=accident', t.coordinatorCookie)).status).toBe(
      400,
    );

    const logs = (await (
      await get('/api/admin/audit-logs?action=report.&limit=200', t.adminCookie)
    ).json()) as AuditLogListResponse;
    const actions = logs.entries.map((e) => e.action);
    expect(actions).toContain('report.list.viewed');
    expect(actions).toContain('report.detail.viewed');
    expect(actions).toContain('report.detail.view_denied');
    expect(actions).toContain('report.list.export.access_denied');
    const exported = logs.entries.filter((e) => e.action === 'report.list.exported');
    expect(exported).toHaveLength(3);
    expect(exported.every((e) => e.level === 'SECURITY')).toBe(true);
  });
});

describe('API: 訪問終わりました(POST /api/reports/visit-complete)', () => {
  it('時刻は HH:mm か空だけ(通知の本文に入れるため)。スタッフごとに1時間の上限があり 429', async () => {
    const t = await createTenant();
    const send = (startTime: string, endTime = '12:00', cookie = t.otherCookie) =>
      post('/api/reports/visit-complete', cookie, {
        customerId: t.customerId,
        visitDate: today(),
        startTime,
        endTime,
      });
    expect((await send('<users/all>')).status).toBe(400);
    expect((await send('09:00\n担当: 偽物')).status).toBe(400);
    expect((await send('09:00')).status).toBe(200);
    expect((await send('', '')).status).toBe(200);
    const limit = container.rateLimits.visitCompleteStaff.limit;
    for (let i = 2; i < limit; i++) expect((await send('09:00')).status).toBe(200);
    const limited = await send('09:00');
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'rate_limited' });
  });
});
