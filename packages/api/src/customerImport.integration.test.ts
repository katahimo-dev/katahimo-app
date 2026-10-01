import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import type { CustomerCsvImportResponse } from '@katahimo/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createContainer } from './container';
import { loadEnv } from './env';

/**
 * 顧客CSVの手動取込(POST /api/admin/customers/import)を実際の DB につないで確かめる。取込元は開発用の
 * CUSTOMER_CSV_LOCAL_DIR/<slug>/(本番は Drive のフォルダ)。テナントは毎回新しく作る。
 */
const csvDir = mkdtempSync(join(tmpdir(), 'katahimo-customer-csv-'));
const env = loadEnv({
  ...process.env,
  NODE_ENV: 'test',
  SCHEDULE_PROVIDER: 'noop',
  MIRROR_TO_GOOGLE_SHEETS: 'false',
  CUSTOMER_CSV_LOCAL_DIR: csvDir,
  SESSION_SECRET: process.env.SESSION_SECRET ?? 'integration-test-session-secret',
  SECRET_BOX_LOCAL_KEY: process.env.SECRET_BOX_LOCAL_KEY ?? 'a'.repeat(64),
});
const appDb = createDatabase(env.DATABASE_URL, { max: 4 });
const ownerDb = createDatabase(process.env.MIGRATION_DATABASE_URL ?? '', { max: 1, onnotice: () => {} });
const container = createContainer(env, appDb);
const app = createApp({ env, container });

const PASSWORD = 'integration-pass-1';
const FIXTURE = readFileSync(
  new URL('../../ingestion/src/reservaCsv/__fixtures__/Kokyaku_202601191958_1_dummy.csv', import.meta.url),
);

async function login(slug: string, email: string): Promise<string> {
  const res = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantSlug: slug, email, password: PASSWORD }),
  });
  expect(res.status).toBe(200);
  return (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const importCsv = (cookie: string, body: unknown) =>
  app.request('/api/admin/customers/import', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

let slug: string;
const cookies = { admin: '', coordinator: '', staff: '' };

beforeAll(async () => {
  slug = `csv-${randomBytes(4).toString('hex')}`;
  const { tenant } = await provisionTenant(
    { tenants: new DrizzleTenantDirectory(ownerDb), provisioning: new DrizzleTenantProvisioning(ownerDb) },
    { slug, name: '顧客CSV 結合テスト' },
  );
  for (const role of ['admin', 'coordinator', 'staff'] as const) {
    const email = `${role}-${slug}@example.com`;
    await registerStaff(container, {
      tenantId: tenant.id,
      name: `${role} 太郎`,
      email,
      password: PASSWORD,
      role,
    });
    cookies[role] = await login(slug, email);
  }
});

afterAll(async () => {
  rmSync(csvDir, { recursive: true, force: true });
  await Promise.all([closeDatabase(appDb, 1), closeDatabase(ownerDb, 1)]);
});

describe('API: 顧客CSVの手動取込', () => {
  it('コーディネーターは新しい版だけを取り込め、force は管理者だけ。一般スタッフは 403', async () => {
    expect((await importCsv(cookies.staff, { force: false })).status).toBe(403);

    // 取込元のフォルダが無い間は not_configured(200)
    const none = await importCsv(cookies.coordinator, { force: false });
    expect(none.status).toBe(200);
    expect(((await none.json()) as CustomerCsvImportResponse).status).toBe('not_configured');

    mkdirSync(join(csvDir, slug), { recursive: true });
    writeFileSync(join(csvDir, slug, 'Kokyaku_202601191958_1.csv'), FIXTURE);
    const first = await importCsv(cookies.coordinator, { force: false });
    expect(first.status).toBe(200);
    const imported = (await first.json()) as CustomerCsvImportResponse;
    expect(imported).toMatchObject({ status: 'imported', fileName: 'Kokyaku_202601191958_1.csv' });
    expect(imported.code).toBeUndefined();
    expect(imported.stats?.created).toBeGreaterThan(0);

    const again = await importCsv(cookies.coordinator, { force: false });
    expect(((await again.json()) as CustomerCsvImportResponse).status).toBe('up_to_date');

    // force は既定 true。コーディネーターは省略しても 403
    expect((await importCsv(cookies.coordinator, {})).status).toBe(403);
    const forced = await importCsv(cookies.admin, {});
    expect(forced.status).toBe(200);
    expect(((await forced.json()) as CustomerCsvImportResponse).status).toBe('imported');
  });

  // 前のテストで取り込んだ顧客を前提にする(同じテナント・同じ取込元のフォルダ)
  it('安全装置で止めたら 409 で、本文はエラーの形(code・message)も満たす', async () => {
    mkdirSync(join(csvDir, slug), { recursive: true });
    writeFileSync(join(csvDir, slug, 'Kokyaku_202601191958_1.csv'), FIXTURE);
    await importCsv(cookies.admin, {});
    const header = FIXTURE.toString('utf16le').split(/\r?\n/)[0] ?? '';
    const oneRow = ['new-customer-1', '新規', '顧客'].join('\t');
    writeFileSync(
      join(csvDir, slug, 'Kokyaku_202602010000_1.csv'),
      Buffer.from(`${header}\r\n${oneRow}\r\n`, 'utf16le'),
    );
    const res = await importCsv(cookies.coordinator, { force: false });
    expect(res.status).toBe(409);
    const body = (await res.json()) as CustomerCsvImportResponse;
    expect(body).toMatchObject({ status: 'review_required', code: 'conflict' });
    expect(body.message).toContain('消えた顧客が多すぎる');

    // もう一度押しても同じ版は読み直さず、同じく 409
    const again = await importCsv(cookies.coordinator, { force: false });
    expect(again.status).toBe(409);
    expect(((await again.json()) as CustomerCsvImportResponse).message).toContain('取り込みを止めています');
  });
});
