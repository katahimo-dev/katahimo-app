import { loadDotenv } from '../loadDotenv';

loadDotenv();

import {
  createCustomer,
  normalizeEmailForIndex,
  registerStaff,
  searchCustomersByFamilyName,
} from '@katahimo/core';
import { getDatabase } from '@katahimo/db';
import { createContainer } from '../container';
import { loadEnv } from '../env';

const DEMO_TENANT_SLUG = 'demo';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin1234';

const DEMO_CUSTOMERS = [
  { name: '佐藤 花子', phone: '090-1111-2222', city: '渋谷区' },
  { name: '佐藤 次郎', phone: '090-3333-4444', city: '新宿区' },
  { name: '鈴木 三郎', phone: '090-5555-6666', city: '渋谷区' },
] as const;

async function main() {
  const env = loadEnv();
  const db = getDatabase();
  const container = createContainer(env, db);

  let tenant = await container.tenants.findBySlug(DEMO_TENANT_SLUG);
  if (!tenant) {
    tenant = await container.tenants.create({ name: 'デモ保育サービス株式会社', slug: DEMO_TENANT_SLUG });
    console.log(`[seed] テナント作成: ${tenant.name} (slug=${tenant.slug}, id=${tenant.id})`);
  } else {
    console.log(`[seed] テナントは既に存在します: ${tenant.name} (id=${tenant.id})`);
  }

  const existingAdmin = await container.staff.findByEmail(tenant.id, normalizeEmailForIndex(ADMIN_EMAIL));
  if (!existingAdmin) {
    await registerStaff(container, {
      tenantId: tenant.id,
      name: '管理者 太郎',
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      isAdmin: true,
    });
    console.log(`[seed] 管理者スタッフ作成: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  } else {
    console.log(`[seed] 管理者スタッフは既に存在します: ${ADMIN_EMAIL}`);
  }

  for (const c of DEMO_CUSTOMERS) {
    const familyName = c.name.split(/[ \u3000]/, 1)[0] ?? c.name;
    const existing = await searchCustomersByFamilyName(container, tenant.id, familyName);
    if (existing.some((row) => row.name === c.name)) {
      console.log(`[seed] 顧客は既に存在します: ${c.name}`);
      continue;
    }
    const created = await createCustomer(container, { tenantId: tenant.id, ...c });
    console.log(`[seed] 顧客作成: ${c.name} (id=${created.id})`);
  }

  console.log('');
  console.log('=== 動作確認手順 ===');
  console.log(
    `curl -c cookies.txt -H "Content-Type: application/json" -d '{"tenantSlug":"${DEMO_TENANT_SLUG}","email":"${ADMIN_EMAIL}","password":"${ADMIN_PASSWORD}"}' http://localhost:8080/api/auth/login`,
  );
  console.log(`curl -b cookies.txt "http://localhost:8080/api/customers?familyName=佐藤"`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
