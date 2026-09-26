/**
 * DB の結合テストの共通部分。接続は .env / CI の DATABASE_URL(katahimo_app)・MIGRATION_DATABASE_URL
 * (katahimo_migrator → 所有者)・WORKER_DATABASE_URL(katahimo_worker)。テナントは毎回新しく作る
 * (slug に乱数を付ける)ため、同じ DB で何度流してもよい。
 */
import { randomBytes } from 'node:crypto';
import type { DailyReportContent } from '@katahimo/core/domain';
import { newId } from '@katahimo/core/domain';
import type { TenantRepositories } from '@katahimo/core/ports';
import { provisionTenant } from '@katahimo/core/usecases';
import { afterAll } from 'vitest';
import { closeDatabase, createDatabase, type Database } from '../client';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '../repositories/platform/tenants';
import { DrizzleUnitOfWork } from '../uow';

function url(name: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL' | 'WORKER_DATABASE_URL'): string {
  const value = process.env[name];
  if (!value) throw new Error(`結合テストには ${name} が必要です`);
  return value;
}

const opened: Database[] = [];
function open(name: Parameters<typeof url>[0], max = 5): Database {
  const db = createDatabase(url(name), { max, onnotice: () => {} });
  opened.push(db);
  return db;
}

/** テストファイルごとの接続(ファイルの終わりに閉じる)。 */
export function connect() {
  const app = open('DATABASE_URL', 8);
  const owner = open('MIGRATION_DATABASE_URL', 2);
  const worker = process.env.WORKER_DATABASE_URL ? open('WORKER_DATABASE_URL', 8) : null;
  afterAll(async () => {
    await Promise.all(opened.splice(0).map((db) => closeDatabase(db, 1)));
  });
  const uow = new DrizzleUnitOfWork(app);

  /** 新しいテナントを platform.provision_tenant() で作る。 */
  async function createTenant(prefix = 'it'): Promise<string> {
    const slug = `${prefix}-${randomBytes(4).toString('hex')}`;
    const { tenant } = await provisionTenant(
      {
        tenants: new DrizzleTenantDirectory(owner),
        provisioning: new DrizzleTenantProvisioning(owner),
      },
      { slug, name: `結合テスト ${slug}` },
    );
    return tenant.id;
  }

  /** スタッフを1人作って ID を返す。 */
  function createStaff(r: TenantRepositories, name = '山田 太郎'): Promise<string> {
    const id = newId();
    return r.staff
      .create({
        id,
        displayName: name,
        familyName: name.split(' ')[0] ?? name,
        givenName: name.split(' ')[1] ?? '',
        email: `${id}@example.com`,
        role: 'staff',
      })
      .then((s) => s.id);
  }

  /** 顧客を1人作って ID を返す。 */
  function createCustomer(r: TenantRepositories, name = '佐藤 花子'): Promise<string> {
    return r.customers
      .create({ id: newId(), displayName: name, familyName: name.split(' ')[0] ?? name, givenName: '' })
      .then((c) => c.id);
  }

  return { app, owner, worker, uow, createTenant, createStaff, createCustomer };
}

/** 日報の本文(care_records.body)。inputText だけを変えて本文の変化を作る。 */
export const reportBody = (inputText: string): DailyReportContent => ({
  startTime: '',
  endTime: '',
  inputText,
  internalText: '',
  customerText: '',
});
