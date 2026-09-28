import { randomBytes } from 'node:crypto';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, withTenant } from '@katahimo/db';
import {
  DrizzleTenantCalendarSettingsStore,
  DrizzleTenantDirectory,
  DrizzleTenantProvisioning,
} from '@katahimo/db/repositories';
import type {
  AdminStaffListResponse,
  AdminStaffResponse,
  AuditLogListResponse,
  StaffImportResponse,
} from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';

/**
 * 管理画面の API(スタッフ管理・操作ログ)を実際の DB につないで確かめる(外部キーによる削除の可否、
 * 操作ログのテナントの分離、CSV)。テナントは毎回新しく作る。
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
  adminId: string;
  staffId: string;
  adminCookie: string;
  staffCookie: string;
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
  const slug = `adm-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    { tenants: new DrizzleTenantDirectory(ownerDb), provisioning: new DrizzleTenantProvisioning(ownerDb) },
    { slug, name: '管理画面 結合テスト' },
  );
  // 運用担当者の設定(pnpm tenant:calendars と同じ): このテナントのスタッフに @cutest.biz のカレンダーを許可する
  await new DrizzleTenantCalendarSettingsStore(ownerDb).set(tenant.id, {
    sharedCalendars: [],
    allowedStaffCalendars: ['@cutest.biz'],
  });
  const register = (name: string, email: string, role: 'staff' | 'admin') =>
    registerStaff(container, { tenantId: tenant.id, name, email, password: PASSWORD, role });
  const admin = await register('管理 太郎', `admin-${slug}@example.com`, 'admin');
  const staff = await register('一般 花子', `staff-${slug}@example.com`, 'staff');
  return {
    id: tenant.id,
    slug,
    adminId: admin.id,
    staffId: staff.id,
    adminCookie: await login(slug, `admin-${slug}@example.com`),
    staffCookie: await login(slug, `staff-${slug}@example.com`),
  };
}

const get = (path: string, cookie: string) => app.request(path, { headers: { Cookie: cookie } });
const send = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

let t: TestTenant;

beforeAll(async () => {
  t = await createTenant();
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());

describe('API: スタッフ管理', () => {
  it('全項目で登録・更新でき、地図APIの無い環境では住所だけを保存して unavailable を返す', async () => {
    const created = await send('POST', '/api/admin/staff', t.adminCookie, {
      name: '佐藤 美咲',
      kana: 'サトウ ミサキ',
      email: `misaki-${t.slug}@example.com`,
      phone: '090-0000-0000',
      role: 'coordinator',
      homeAddress: '東京都世田谷区用賀4-1-1',
      travelMode: 'bicycle',
      gender: 'female',
      scheduleCalendarId: `misaki-${t.slug}@cutest.biz`,
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as AdminStaffResponse;
    expect(body).toMatchObject({
      homeGeocode: 'unavailable',
      staff: {
        kana: 'サトウ ミサキ',
        homeAddress: '東京都世田谷区用賀4-1-1',
        hasHomeGeo: false,
        travelMode: 'bicycle',
        gender: 'female',
        scheduleCalendarId: `misaki-${t.slug}@cutest.biz`,
        passwordStatus: 'unset',
        rowVersion: 1,
      },
    });

    const patched = await send('PATCH', `/api/admin/staff/${body.staff.id}`, t.adminCookie, {
      phone: '',
      scheduleCalendarId: null,
      rowVersion: 1,
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as AdminStaffResponse).staff).toMatchObject({
      phone: null,
      scheduleCalendarId: null,
      rowVersion: 2,
    });

    const stale = await send('PATCH', `/api/admin/staff/${body.staff.id}`, t.adminCookie, {
      phone: '080',
      rowVersion: 1,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: 'conflict' });
  });

  it('入力の誤りは項目名つきの 400、rowVersion だけでは更新する項目が無い', async () => {
    const res = await send('POST', '/api/admin/staff', t.adminCookie, {
      name: '',
      email: 'not-mail',
      scheduleCalendarId: 'no at mark',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'validation_failed',
      fields: { name: expect.any(String), email: expect.any(String), scheduleCalendarId: expect.any(String) },
    });
    const empty = await send('PATCH', `/api/admin/staff/${t.staffId}`, t.adminCookie, { rowVersion: 1 });
    expect(empty.status).toBe(400);
  });

  it('記録の無いスタッフは削除でき(認証情報・メールも消える)、出勤簿のあるスタッフは 409、自分自身は 400', async () => {
    const created = (await (
      await send('POST', '/api/admin/staff', t.adminCookie, {
        name: '間違い 登録',
        email: `wrong-${t.slug}@example.com`,
        initialPassword: 'mistaken-pass-1',
      })
    ).json()) as AdminStaffResponse;
    const deleted = await send('DELETE', `/api/admin/staff/${created.staff.id}`, t.adminCookie);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    const list = (await (await get('/api/admin/staff', t.adminCookie)).json()) as { staff: { id: string }[] };
    expect(list.staff.map((s) => s.id)).not.toContain(created.staff.id);
    // 同じメールでもう一度登録できる(ログイン用メールも消えている)
    const again = await send('POST', '/api/admin/staff', t.adminCookie, {
      name: '登録 し直し',
      email: `wrong-${t.slug}@example.com`,
    });
    expect(again.status).toBe(201);

    const saved = await send('PUT', '/api/attendance/day', t.staffCookie, {
      date: today(),
      rowData: { C: '佐藤様' },
      rowVersion: 0,
    });
    expect(saved.status).toBe(200);
    const referenced = await send('DELETE', `/api/admin/staff/${t.staffId}`, t.adminCookie);
    expect(referenced.status).toBe(409);
    expect(await referenced.json()).toMatchObject({
      code: 'conflict',
      message: expect.stringContaining('退職日を設定してください'),
    });

    const self = await send('DELETE', `/api/admin/staff/${t.adminId}`, t.adminCookie);
    expect(self.status).toBe(400);
    expect((await send('DELETE', `/api/admin/staff/${t.staffId}`, t.staffCookie)).status).toBe(403);
  });

  it('パスワード設定の案内は未設定のスタッフだけ(設定済みは 400)', async () => {
    const created = (await (
      await send('POST', '/api/admin/staff', t.adminCookie, {
        name: '案内 太郎',
        email: `guide-${t.slug}@example.com`,
      })
    ).json()) as AdminStaffResponse;
    const guided = await send('POST', `/api/admin/staff/${created.staff.id}/password-guide`, t.adminCookie);
    expect(guided.status).toBe(200);
    const already = await send('POST', `/api/admin/staff/${t.staffId}/password-guide`, t.adminCookie);
    expect(already.status).toBe(400);
  });
});

describe('API: スタッフ管理の守り', () => {
  it('許可の一覧に無いカレンダーは 400(項目の誤り)。テナントのカレンダーの設定はアプリの接続からは書けない', async () => {
    const res = await send('POST', '/api/admin/staff', t.adminCookie, {
      name: '他社 カレンダー',
      email: `cal-${t.slug}@example.com`,
      scheduleCalendarId: 'someone@other-tenant.example.org',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'validation_failed',
      fields: { scheduleCalendarId: 'このカレンダーは使えません。運用担当者に登録を依頼してください' },
    });
    await expect(
      new DrizzleTenantCalendarSettingsStore(appDb).set(t.id, {
        sharedCalendars: [],
        allowedStaffCalendars: ['@x.jp'],
      }),
    ).rejects.toThrow();
  });

  it('変更の履歴(AIプロンプトの版)に残っている管理者は、管理者を外しても削除できない', async () => {
    const email = `editor-${t.slug}@example.com`;
    const created = (await (
      await send('POST', '/api/admin/staff', t.adminCookie, {
        name: '編集 者',
        email,
        role: 'admin',
        initialPassword: PASSWORD,
      })
    ).json()) as AdminStaffResponse;
    const editorCookie = await login(t.slug, email);
    const prompts = (await (await get('/api/settings/admin/prompts', editorCookie)).json()) as {
      prompts: { key: string; revision: number }[];
    };
    const prompt = prompts.prompts[0];
    const saved = await send('PUT', '/api/settings/admin/prompts', editorCookie, {
      prompts: [{ key: prompt?.key, body: '編集者の文', revision: prompt?.revision }],
    });
    expect(saved.status).toBe(200);
    await send('PUT', '/api/settings/admin/prompts', editorCookie, {
      prompts: [{ key: prompt?.key, body: null }],
    });
    const demoted = await send('PATCH', `/api/admin/staff/${created.staff.id}`, t.adminCookie, {
      role: 'staff',
    });
    expect(demoted.status).toBe(200);
    const res = await send('DELETE', `/api/admin/staff/${created.staff.id}`, t.adminCookie);
    expect(res.status).toBe(409);
  });

  it('2人の管理者が同時に互いを外しても、管理者は1人残る', async () => {
    const other = await createTenant();
    const second = (await (
      await send('POST', '/api/admin/staff', other.adminCookie, {
        name: '二人目 管理者',
        email: `second-${other.slug}@example.com`,
        role: 'admin',
        initialPassword: PASSWORD,
      })
    ).json()) as AdminStaffResponse;
    const secondCookie = await login(other.slug, `second-${other.slug}@example.com`);
    const [a, b] = await Promise.all([
      send('PATCH', `/api/admin/staff/${second.staff.id}`, other.adminCookie, { role: 'staff' }),
      send('PATCH', `/api/admin/staff/${other.adminId}`, secondCookie, { role: 'staff' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 403]);
    const list = (await (
      await get('/api/admin/staff', a.status === 200 ? other.adminCookie : secondCookie)
    ).json()) as { staff: { role: string }[] };
    expect(list.staff.filter((s) => s.role === 'admin')).toHaveLength(1);
  });
});

describe('API: スタッフの xlsx', () => {
  const exportXlsx = async () => {
    const res = await get('/api/admin/staff/export.xlsx', t.adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml');
    return Buffer.from(await res.arrayBuffer());
  };
  const importXlsx = async (body: Buffer, dryRun: boolean) => {
    const res = await send('POST', '/api/admin/staff/import', t.adminCookie, {
      fileName: 'staff.xlsx',
      fileBase64: body.toString('base64'),
      dryRun,
    });
    expect(res.status).toBe(200);
    return (await res.json()) as StaffImportResponse;
  };

  it('書き出した xlsx をそのまま確かめると変更なし。行を足して反映すると登録され、import_runs が残る', async () => {
    const list = (await (await get('/api/admin/staff', t.adminCookie)).json()) as AdminStaffListResponse;
    const exported = await exportXlsx();
    const dry = await importXlsx(exported, true);
    expect(dry).toMatchObject({
      dryRun: true,
      applied: false,
      counts: { rows: list.staff.length, created: 0, updated: 0, unchanged: list.staff.length },
      changes: [],
      errors: [],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported as unknown as ArrayBuffer);
    const ws = workbook.getWorksheet('スタッフ') as ExcelJS.Worksheet;
    ws.addRow([
      null,
      '取込 一郎',
      null,
      `ichiro-${t.slug}@example.com`,
      null,
      '080',
      'コーディネーター',
      null,
      null,
      '徒歩',
    ]);
    const edited = Buffer.from(await workbook.xlsx.writeBuffer());
    const applied = await importXlsx(edited, false);
    expect(applied).toMatchObject({
      applied: true,
      counts: { created: 1, updated: 0 },
      changes: [{ kind: 'create', name: '取込 一郎' }],
    });
    const after = (await (await get('/api/admin/staff', t.adminCookie)).json()) as AdminStaffListResponse;
    expect(after.staff.find((s) => s.email === `ichiro-${t.slug}@example.com`)).toMatchObject({
      role: 'coordinator',
      phone: '080',
      travelMode: 'walk',
      passwordStatus: 'unset',
    });
    const runs = await withTenant(appDb, t.id, (tx) =>
      tx.execute(sql`select source, status from import_runs where source = 'staff_xlsx'`),
    );
    expect([...runs]).toEqual([{ source: 'staff_xlsx', status: 'applied' }]);
  });

  it('一般スタッフは書き出し・取込とも 403', async () => {
    expect((await get('/api/admin/staff/export.xlsx', t.staffCookie)).status).toBe(403);
    const res = await send('POST', '/api/admin/staff/import', t.staffCookie, {
      fileBase64: 'AA==',
      dryRun: true,
    });
    expect(res.status).toBe(403);
  });

  it('xlsx でないファイルは 400', async () => {
    const res = await send('POST', '/api/admin/staff/import', t.adminCookie, {
      fileBase64: Buffer.from('not a zip').toString('base64'),
      dryRun: true,
    });
    expect(res.status).toBe(400);
  });
});

describe('API: 操作ログ', () => {
  it('テナントのログだけを新しい順に返し、ログイン前・別テナントのログは出さない。閲覧も記録する', async () => {
    const marker = `test.marker_${randomBytes(3).toString('hex')}`;
    await container.appLog.write({ tenantId: null, level: 'WARN', action: marker });
    const other = await createTenant();
    await container.appLog.write({ tenantId: other.id, level: 'WARN', action: marker });
    await container.appLog.write({ tenantId: t.id, level: 'WARN', action: marker, actorStaffId: t.staffId });

    const res = await get(`/api/admin/audit-logs?action=${marker}`, t.adminCookie);
    expect(res.status).toBe(200);
    const page = (await res.json()) as AuditLogListResponse;
    expect(page.entries).toEqual([
      expect.objectContaining({ action: marker, actorStaffId: t.staffId, actorName: '一般 花子' }),
    ]);
    expect(page.timeZone).toBe('Asia/Tokyo');

    const all = (await (
      await get('/api/admin/audit-logs?limit=200', t.adminCookie)
    ).json()) as AuditLogListResponse;
    const actions = all.entries.map((e) => e.action);
    expect(actions[0]).toBe('audit_log.viewed');
    expect(actions).toContain('staff.admin.created');
    expect(actions).toContain('staff.admin.deleted');
    const times = all.entries.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('keyset ページングで重複なく続きを読める。絞り込み(スタッフ・レベル)が効く', async () => {
    const first = (await (
      await get('/api/admin/audit-logs?limit=2', t.adminCookie)
    ).json()) as AuditLogListResponse;
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await (
      await get(
        `/api/admin/audit-logs?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        t.adminCookie,
      )
    ).json()) as AuditLogListResponse;
    const ids = [...first.entries, ...second.entries].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect((second.entries[0]?.createdAt ?? '') <= (first.entries[1]?.createdAt ?? '')).toBe(true);

    const byStaff = (await (
      await get(`/api/admin/audit-logs?staffId=${t.staffId}&limit=200`, t.adminCookie)
    ).json()) as AuditLogListResponse;
    expect(byStaff.entries.length).toBeGreaterThan(0);
    expect(byStaff.entries.every((e) => e.actorStaffId === t.staffId || e.targetStaffId === t.staffId)).toBe(
      true,
    );
    const security = (await (
      await get('/api/admin/audit-logs?level=SECURITY&limit=200', t.adminCookie)
    ).json()) as AuditLogListResponse;
    expect(security.entries.every((e) => e.level === 'SECURITY')).toBe(true);
  });

  it('期間は93日まで。管理者以外は 403', async () => {
    const tooLong = await get('/api/admin/audit-logs?from=2026-01-01&to=2026-09-01', t.adminCookie);
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({
      code: 'validation_failed',
      fields: { from: expect.any(String) },
    });
    expect((await get('/api/admin/audit-logs', t.staffCookie)).status).toBe(403);
    expect((await get('/api/admin/audit-logs.csv', t.staffCookie)).status).toBe(403);
  });

  it('CSV は BOM つき UTF-8・日本語の見出しで、ダウンロードを記録する', async () => {
    const res = await get('/api/admin/audit-logs.csv?action=staff.admin', t.adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="audit-logs_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes.slice(3));
    const [header, ...rows] = text.trimEnd().split('\r\n');
    expect(header).toBe(
      '日時,レベル,操作,操作コード,操作者の種類,操作者,対象スタッフ,詳細,IPアドレス,ユーザーエージェント,リクエストID',
    );
    expect(rows.some((r) => r.includes('スタッフの登録') && r.includes('staff.admin.created'))).toBe(true);
    expect(rows.every((r) => r.includes('staff.admin.'))).toBe(true);

    const logs = (await (
      await get('/api/admin/audit-logs?action=audit_log.exported', t.adminCookie)
    ).json()) as AuditLogListResponse;
    expect(logs.entries[0]).toMatchObject({
      level: 'SECURITY',
      actorStaffId: t.adminId,
      details: { action: 'staff.admin' },
    });
  });
});
