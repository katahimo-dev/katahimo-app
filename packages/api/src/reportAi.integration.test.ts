import { randomBytes } from 'node:crypto';
import { newId, parseReportAiWorkbook } from '@katahimo/core/domain';
import { syntheticMasterSheets } from '@katahimo/core/test-utils';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase, withTenant } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import type {
  CustomerReportProfileView,
  GenerateDailyReportRequest,
  ReportAiImportResponse,
  ReportAiMastersResponse,
} from '@katahimo/shared';
import { XLSX_CONTENT_TYPE } from '@katahimo/shared';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';
import { readReportAiWorkbook } from './export/reportAiWorkbook';

/**
 * 日報AIの調整の API を実際の DB につないで確かめる: 管理画面(管理者だけ・xlsx の取込・行ごとの編集の 409・
 * 書き出し・利用状況の CSV)、家庭の★(スタッフ全員)、生成 → 保存の記録の結び付け、PSI の知らせ(Web Push の
 * outbox)。Gemini の API キーは無い(生成は「API Key Missing」の形で返る)。
 */
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  GEMINI_API_KEY: '',
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
  VAPID_PUBLIC_KEY: Buffer.alloc(65, 4).toString('base64url'),
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
  adminId: string;
  customerId: string;
  childId: string;
  staffCookie: string;
  otherCookie: string;
  coordinatorCookie: string;
  adminCookie: string;
}

const request = (method: string, path: string, cookie: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function login(slug: string, email: string): Promise<string> {
  const res = await request('POST', '/api/auth/login', '', { tenantSlug: slug, email, password: PASSWORD });
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

async function createTenant(): Promise<TestTenant> {
  const slug = `rai-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    { tenants: new DrizzleTenantDirectory(ownerDb), provisioning: new DrizzleTenantProvisioning(ownerDb) },
    { slug, name: '日報AI 結合テスト' },
  );
  const register = (name: string, email: string, role: 'staff' | 'coordinator' | 'admin') =>
    registerStaff(container, { tenantId: tenant.id, name, email, password: PASSWORD, role });
  const staff = await register('一般 花子', `staff-${slug}@example.com`, 'staff');
  await register('一般 次郎', `other-${slug}@example.com`, 'staff');
  await register('調整 役', `coord-${slug}@example.com`, 'coordinator');
  const admin = await register('管理 太郎', `admin-${slug}@example.com`, 'admin');
  const { customerId, childId } = await container.uow.run(tenant.id, async (r) => {
    const customer = await r.customers.create({
      id: newId(),
      displayName: '佐藤 はな',
      familyName: '佐藤',
      givenName: 'はな',
    });
    const childId = newId();
    await r.careRecipients.insert({
      id: childId,
      customerId: customer.id,
      name: 'はな',
      nameKana: null,
      birthDate: '2025-07-10',
      sex: null,
      allergy: null,
      needs: null,
      sortOrder: 0,
    });
    return { customerId: customer.id, childId };
  });
  return {
    id: tenant.id,
    slug,
    staffId: staff.id,
    adminId: admin.id,
    customerId,
    childId,
    staffCookie: await login(slug, `staff-${slug}@example.com`),
    otherCookie: await login(slug, `other-${slug}@example.com`),
    coordinatorCookie: await login(slug, `coord-${slug}@example.com`),
    adminCookie: await login(slug, `admin-${slug}@example.com`),
  };
}

/** お客様のマスターと同じ形の架空の xlsx(base64)。 */
async function syntheticXlsxBase64(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of syntheticMasterSheets()) {
    const ws = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) ws.addRow([...row]);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64');
}

let t: TestTenant;
let other: TestTenant;

beforeAll(async () => {
  [t, other] = await Promise.all([createTenant(), createTenant()]);
});

afterAll(async () => {
  await Promise.all([closeDatabase(appDb), closeDatabase(ownerDb)]);
});

describe('管理画面「日報AIの調整」', () => {
  it('管理者だけが使える(一般スタッフ・コーディネーターは 403)', async () => {
    for (const cookie of [t.staffCookie, t.coordinatorCookie]) {
      expect((await request('GET', '/api/admin/report-ai', cookie)).status).toBe(403);
      expect(
        (await request('POST', '/api/admin/report-ai/import', cookie, { fileBase64: 'eA==', dryRun: true }))
          .status,
      ).toBe(403);
      expect((await request('GET', '/api/admin/report-ai/export.xlsx', cookie)).status).toBe(403);
    }
    expect((await request('GET', '/api/admin/report-ai', '')).status).toBe(401);
  });

  it('xlsx を確かめてから反映し、他のテナントには入らない。書き出したファイルは取り込める', async () => {
    const fileBase64 = await syntheticXlsxBase64();
    const preview = await request('POST', '/api/admin/report-ai/import', t.adminCookie, {
      fileBase64,
      fileName: 'master.xlsx',
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as ReportAiImportResponse;
    expect(previewBody).toMatchObject({ dryRun: true, applied: false, errors: [] });
    expect(previewBody.counts.keywords).toEqual({ rows: 3, created: 3, updated: 0, unchanged: 0 });
    expect(
      (
        (await (
          await request('GET', '/api/admin/report-ai', t.adminCookie)
        ).json()) as ReportAiMastersResponse
      ).keywords,
    ).toEqual([]);

    const applied = (await (
      await request('POST', '/api/admin/report-ai/import', t.adminCookie, { fileBase64, dryRun: false })
    ).json()) as ReportAiImportResponse;
    expect(applied.applied).toBe(true);
    const masters = (await (
      await request('GET', '/api/admin/report-ai', t.adminCookie)
    ).json()) as ReportAiMastersResponse;
    expect(masters.keywords.map((k) => k.code)).toEqual(['K01', 'K02', 'K03']);
    expect(masters.psiLevels).toHaveLength(5);
    const otherMasters = (await (
      await request('GET', '/api/admin/report-ai', other.adminCookie)
    ).json()) as ReportAiMastersResponse;
    expect(otherMasters.keywords).toEqual([]);

    const exported = await request('GET', '/api/admin/report-ai/export.xlsx', t.adminCookie);
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toBe(XLSX_CONTENT_TYPE);
    const reparsed = parseReportAiWorkbook(
      await readReportAiWorkbook(Buffer.from(await exported.arrayBuffer())),
    );
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.keywords.map((k) => k.code)).toEqual(['K01', 'K02', 'K03']);

    // 読めないファイルは 400
    const broken = await request('POST', '/api/admin/report-ai/import', t.adminCookie, {
      fileBase64: Buffer.from('not xlsx').toString('base64'),
      dryRun: true,
    });
    expect(broken.status).toBe(400);
  });

  it('行ごとの編集: 版が古ければ 409、同じ ID は 409、外した行は一覧から消える', async () => {
    const row = {
      code: 'k50',
      keyword: '結合の語',
      ageFromMonths: 0,
      ageToMonths: 84,
      educationLevelMin: 3,
      educationLevelMax: 5,
      psiMin: 3,
    };
    const created = await request('POST', '/api/admin/report-ai/keywords', t.adminCookie, { row });
    expect(created.status).toBe(201);
    const { id, rowVersion } = (await created.json()) as { id: string; rowVersion: number };
    expect((await request('POST', '/api/admin/report-ai/keywords', t.adminCookie, { row })).status).toBe(409);
    const updated = await request('PUT', `/api/admin/report-ai/keywords/${id}`, t.adminCookie, {
      row: { ...row, keyword: '変えた語' },
      rowVersion,
    });
    expect(updated.status).toBe(200);
    const stale = await request('PUT', `/api/admin/report-ai/keywords/${id}`, t.adminCookie, {
      row,
      rowVersion,
    });
    expect(stale.status).toBe(409);
    expect(
      (
        await request('PUT', '/api/admin/report-ai/psi-levels/3', t.adminCookie, {
          row: { level: 3, label: '要観察(テナント)', criteria: '基準' },
        })
      ).status,
    ).toBe(200);
    expect((await request('DELETE', `/api/admin/report-ai/keywords/${id}`, t.adminCookie, {})).status).toBe(
      200,
    );
    const masters = (await (
      await request('GET', '/api/admin/report-ai', t.adminCookie)
    ).json()) as ReportAiMastersResponse;
    expect(masters.keywords.map((k) => k.code)).not.toContain('K50');
    // PSI の定義は日報の画面の評価の説明にも出る
    const ui = (await (await request('GET', '/api/ui-config', t.staffCookie)).json()) as {
      assessments: { risk: { levels: { score: number; label: string }[] } };
    };
    expect(ui.assessments.risk.levels.find((l) => l.score === 3)?.label).toBe('要観察(テナント)');
    // 教育思考★の説明(テナントの行が無い段階は既定の文言)
    const eduUi = (await (await request('GET', '/api/ui-config', t.staffCookie)).json()) as {
      educationLevels: { levels: { score: number; label: string }[] };
    };
    expect(eduUi.educationLevels.levels.map((l) => l.score)).toEqual([1, 2, 3, 4, 5]);
    // 他のテナントの行は触れない
    expect(
      (await request('DELETE', `/api/admin/report-ai/keywords/${id}`, other.adminCookie, {})).status,
    ).toBe(404);
  });

  it('キーワードの利用状況の CSV(BOM つき)', async () => {
    const res = await request(
      'GET',
      '/api/admin/report-ai/usage.csv?from=2026-01-01&to=2026-12-31',
      t.adminCookie,
    );
    expect(res.status).toBe(200);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString('utf8').split('\r\n')[0]).toBe(
      'ID,キーワード,カテゴリ,候補に出した回数,AIが使った回数,候補外でAIが使ったと答えた回数',
    );
    expect(
      (await request('GET', '/api/admin/report-ai/usage.csv?from=2025-01-01&to=2026-12-31', t.adminCookie))
        .status,
    ).toBe(400);
  });
});

describe('家庭の教育思考★', () => {
  it('ログインしているスタッフなら誰でも見られて変えられ、古い版は 409・他のテナントのお客様は 404', async () => {
    const path = `/api/customers/${t.customerId}/report-profile`;
    const read = async (cookie: string) =>
      ((await (await request('GET', path, cookie)).json()) as { profile: CustomerReportProfileView }).profile;
    expect(await read(t.staffCookie)).toMatchObject({ educationLevel: null, rowVersion: null });
    expect((await request('PUT', path, t.staffCookie, { educationLevel: 4 })).status).toBe(200);
    expect((await request('PUT', path, t.otherCookie, { educationLevel: 3 })).status).toBe(409);
    expect((await request('PUT', path, t.otherCookie, { educationLevel: 3, rowVersion: 1 })).status).toBe(
      200,
    );
    expect(await read(t.coordinatorCookie)).toMatchObject({
      educationLevel: 3,
      rowVersion: 2,
      updatedByName: '一般 次郎',
    });
    expect((await request('GET', path, other.staffCookie)).status).toBe(404);
    expect((await request('PUT', path, t.staffCookie, { educationLevel: 6, rowVersion: 2 })).status).toBe(
      400,
    );
    // null で未設定に戻す(行は残って版は続く)
    expect((await request('PUT', path, t.staffCookie, { educationLevel: null, rowVersion: 2 })).status).toBe(
      200,
    );
    expect(await read(t.otherCookie)).toMatchObject({
      educationLevel: null,
      rowVersion: 3,
      updatedByName: '一般 花子',
    });
    expect((await request('PUT', path, t.otherCookie, { educationLevel: null, rowVersion: 2 })).status).toBe(
      409,
    );
    expect((await request('PUT', path, t.otherCookie, { rowVersion: 3 })).status).toBe(400);
  });
});

describe('日報の生成 → 保存', () => {
  const generate = (cookie: string, body: Partial<GenerateDailyReportRequest>) =>
    request('POST', '/api/reports/daily/generate', cookie, {
      text: 'メモ',
      start: '09:00',
      end: '12:00',
      ...body,
    });

  it('生成を記録し(API キーが無ければその形で返る)、別の世帯の子は 400', async () => {
    const res = await generate(t.staffCookie, {
      customerId: t.customerId,
      careRecipientId: t.childId,
      riskRating: 1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: { warnings: string[] }; ai: { generationId: string | null } };
    expect(body.draft.warnings).toEqual(['API Key Missing']);
    expect(body.ai.generationId).not.toBeNull();
    const recorded = await container.uow.run(t.id, (r) =>
      r.reportAiGenerations.findById(body.ai.generationId as string),
    );
    expect(recorded).toMatchObject({
      customerId: t.customerId,
      careRecipientId: t.childId,
      errorCode: 'api_key_missing',
    });
    expect(
      (await generate(t.staffCookie, { customerId: t.customerId, careRecipientId: other.childId })).status,
    ).toBe(400);
    expect((await generate(t.staffCookie, { customerId: other.customerId })).status).toBe(404);
  });

  it('保存で生成の記録を結び付け・対象のお子様を持ち、PSI 2 以下は管理者の端末に知らせを積む(同じ PSI の保存し直しでは積まない)', async () => {
    // 管理者の端末を登録する
    const subscribed = await request('POST', '/api/push/subscriptions', t.adminCookie, {
      endpoint: `https://fcm.googleapis.com/fcm/send/admin-${t.slug}`,
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    });
    expect(subscribed.status).toBe(200);
    // 成功した生成の記録(Gemini を呼べないため直接書く)
    const generationId = newId();
    await container.uow.run(t.id, (r) =>
      r.reportAiGenerations.insert({
        id: generationId,
        staffId: t.staffId,
        customerId: t.customerId,
        careRecipientId: t.childId,
        promptKey: 'daily_report.generate',
        promptRevision: null,
        defaultPromptSha256: 'b'.repeat(64),
        appVersion: null,
        model: 'gemini-test',
        promptText: 'p',
        inputText: 'メモ',
        timeInfo: '09:00〜12:00',
        startedAt: new Date(),
        finishedAt: new Date(),
        childAgeMonths: 14,
        educationLevel: 2,
        effectiveEducationLevel: null,
        riskRating: 1,
        escalationRequired: true,
        candidateKeywordIds: [],
        usedKeywordIds: [],
        unresolvedUsedCodes: [],
        output: { warnings: [] },
        errorCode: null,
      }),
    );
    const daily = {
      customerId: t.customerId,
      reportDate: '2026-09-25',
      startTime: '09:00',
      endTime: '12:00',
      inputText: 'メモ',
      internalText: '社内',
      customerText: '保護者',
      riskRating: 1,
      esRating: null,
      careRecipientId: t.childId,
      aiGenerationId: generationId,
    };
    // 他のスタッフは他人の生成を結び付けられない
    expect((await request('POST', '/api/reports/daily', t.otherCookie, daily)).status).toBe(400);
    const saved = await request('POST', '/api/reports/daily', t.staffCookie, daily);
    expect(saved.status).toBe(200);
    const report = (
      (await saved.json()) as {
        report: { id: string; psiAlert: boolean; careRecipientId: string; rowVersion: number };
      }
    ).report;
    expect(report).toMatchObject({ psiAlert: true, careRecipientId: t.childId });
    const linked = await container.uow.run(t.id, (r) => r.reportAiGenerations.findById(generationId));
    expect(linked?.careRecordId).toBe(report.id);
    const outbox = (await withTenant(ownerDb, t.id, (tx) =>
      tx.execute(sql`select topic, payload from outbox_messages where topic = 'push.psi_alert'`),
    )) as unknown as { topic: string; payload: { staffId: string } }[];
    expect(outbox.map((m) => m.payload.staffId)).toEqual([t.adminId]);
    // 同じ PSI のまま保存し直しても、もう一度は知らせない
    const resaved = await request('POST', '/api/reports/daily', t.staffCookie, {
      ...daily,
      reportId: report.id,
      rowVersion: report.rowVersion,
      customerText: '保護者(手直し)',
    });
    expect(resaved.status).toBe(200);
    expect(((await resaved.json()) as { report: { psiAlert: boolean } }).report.psiAlert).toBe(false);
    const outboxAfter = (await withTenant(ownerDb, t.id, (tx) =>
      tx.execute(sql`select id from outbox_messages where topic = 'push.psi_alert'`),
    )) as unknown as unknown[];
    expect(outboxAfter).toHaveLength(1);
    // 報告一覧の PSI(印は画面が PSI 2 以下で付ける)
    const list = (await (
      await request('GET', '/api/reports?kind=daily_report&from=2026-09-01&to=2026-09-30', t.adminCookie)
    ).json()) as {
      reports: { id: string; riskRating: number | null }[];
    };
    expect(list.reports.find((r) => r.id === report.id)?.riskRating).toBe(1);
  });
});
