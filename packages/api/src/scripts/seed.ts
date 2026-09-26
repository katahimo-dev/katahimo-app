import { loadDotenv } from '../loadDotenv';

loadDotenv();

import type { StaffRole } from '@katahimo/core/domain';
import { normalizeEmailForIndex } from '@katahimo/core/domain';
import type { CustomerSnapshot } from '@katahimo/core/usecases';
import { applyCustomerSnapshot, provisionTenant, registerStaff } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import { createContainer } from '../container';
import { loadEnv } from '../env';

const DEMO_TENANT = { slug: 'demo', name: 'デモ保育サービス株式会社' };
const DEMO_PASSWORD = 'admin1234';

const DEMO_STAFF: { name: string; email: string; role: StaffRole }[] = [
  { name: '管理者 太郎', email: 'admin@example.com', role: 'admin' },
  { name: '調整 花子', email: 'coordinator@example.com', role: 'coordinator' },
  { name: '佐藤 美咲', email: 'staff@example.com', role: 'staff' },
];

const snapshot = (
  externalId: string,
  familyName: string,
  givenName: string,
  city: string,
  recipients: CustomerSnapshot['recipients'],
): CustomerSnapshot => ({
  source: 'reserva',
  externalId,
  displayName: `${familyName} ${givenName}`,
  familyName,
  givenName,
  phone: '090-0000-0000',
  attributes: { member_type: '一般' },
  home: { addressLine: `東京都${city}1-2-3`, prefecture: '東京都', city },
  secondary: null,
  emergencyContact: { relation: '父', phone: '090-1111-1111' },
  recipients,
});

const DEMO_CUSTOMERS: CustomerSnapshot[] = [
  snapshot('DEMO-0001', '佐藤', '花子', '渋谷区', [
    { name: '佐藤 一郎', birthDate: '2022-04-01', allergy: '卵' },
  ]),
  snapshot('DEMO-0002', '鈴木', '次郎', '新宿区', [
    { name: '鈴木 三郎', birthDate: '2023-08-15', needs: '午睡は13時から' },
  ]),
  snapshot('DEMO-0003', '田中', '美和', '世田谷区', []),
];

/**
 * 開発用のデモデータ(何度流してもよい)。テナントは platform.provision_tenant()(所有者の権限。
 * MIGRATION_DATABASE_URL の接続)で作り、スタッフ・顧客はアプリの接続(DATABASE_URL、RLS の中)で作る。
 */
async function main() {
  const env = loadEnv();
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl)
    throw new Error('テナントの作成には MIGRATION_DATABASE_URL(katahimo_migrator)が必要です');

  const ownerDb = createDatabase(migrationUrl, { max: 1, onnotice: () => {} });
  const appDb = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const { tenant, created } = await provisionTenant(
      {
        tenants: new DrizzleTenantDirectory(ownerDb),
        provisioning: new DrizzleTenantProvisioning(ownerDb),
      },
      DEMO_TENANT,
    );
    console.log(
      `[seed] テナント${created ? 'を作成' : 'は既にあります'}: ${tenant.name} (slug=${tenant.slug}, id=${tenant.id})`,
    );

    const container = createContainer(env, appDb);
    for (const staff of DEMO_STAFF) {
      const exists = await container.uow.run(tenant.id, (r) =>
        r.staff.findByLoginEmail(normalizeEmailForIndex(staff.email)),
      );
      if (exists) continue;
      await registerStaff(container, { tenantId: tenant.id, ...staff, password: DEMO_PASSWORD });
      console.log(`[seed] スタッフを作成: ${staff.email} (${staff.role})`);
    }

    const outcomes = await container.uow.run(tenant.id, async (r) => {
      const results: string[] = [];
      // 顧客の取込(顧客CSV・外部連携の API)と重ならないようにする
      await r.importRuns.lockTenantCustomerImports();
      for (const customer of DEMO_CUSTOMERS) {
        results.push(await applyCustomerSnapshot({ runId: null }, r, customer, new Date()));
      }
      if (results.some((o) => o !== 'unchanged')) await r.settings.bumpCustomerDataVersion();
      return results;
    });
    console.log(`[seed] 顧客: ${outcomes.join(', ')}`);

    console.log('');
    console.log('=== 動作確認 ===');
    console.log(`会社ID: ${DEMO_TENANT.slug} / パスワード: ${DEMO_PASSWORD}`);
    for (const staff of DEMO_STAFF) console.log(`  ${staff.email} (${staff.role})`);
  } finally {
    await Promise.all([closeDatabase(ownerDb), closeDatabase(appDb)]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
