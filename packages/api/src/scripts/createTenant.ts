import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { randomBytes } from 'node:crypto';
import { bootstrapTenant } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import { DrizzleTenantDirectory, DrizzleTenantProvisioning } from '@katahimo/db/repositories';
import { createContainer } from '../container';
import { loadEnv } from '../env';
import { cliArgs, takeOption } from './cliArgs';

const USAGE =
  '使い方: pnpm --filter @katahimo/api tenant:create -- <slug> <法人名> <管理者のメール> ' +
  '[--admin-name <氏名>] [--timezone <IANA名>] [--initial-password]';

/**
 * 本番のテナント(法人)と最初の管理者を作る運用スクリプト(何度流してもよい。doc/07_インフラ・運用.md)。
 * テナントは platform.provision_tenant()(所有者の権限。MIGRATION_DATABASE_URL の接続)で作り、
 * 管理者はアプリの接続(DATABASE_URL、RLS の中)で作る。
 *
 * 管理者のパスワードは既定では未設定(本人がログイン画面の「パスワードを忘れた方」で設定する。メールはワーカーが
 * 送る)。--initial-password を付けると初期パスワードを作って1回だけ表示する(本人に安全な方法で伝え、
 * 最初のログインの後に設定の「パスワード変更」で変えてもらう)。
 */
async function main() {
  const args = cliArgs();
  const withInitialPassword = args.includes('--initial-password');
  const adminName = takeOption(
    args.filter((a) => a !== '--initial-password'),
    '--admin-name',
  );
  const timezone = takeOption(adminName.rest, '--timezone');
  const [slug, name, adminEmail, ...extra] = timezone.rest;
  if (!slug || !name || !adminEmail || extra.length > 0) {
    console.error(USAGE);
    process.exit(1);
  }

  const env = loadEnv();
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl) {
    throw new Error('テナントの作成には MIGRATION_DATABASE_URL(katahimo_migrator)が必要です');
  }
  const initialPassword = withInitialPassword ? randomBytes(12).toString('base64url') : undefined;

  const ownerDb = createDatabase(migrationUrl, { max: 1, onnotice: () => {} });
  const appDb = createDatabase(env.DATABASE_URL, { max: 2 });
  try {
    const container = createContainer(env, appDb);
    const result = await bootstrapTenant(
      {
        ...container,
        tenants: new DrizzleTenantDirectory(ownerDb),
        provisioning: new DrizzleTenantProvisioning(ownerDb),
      },
      {
        slug,
        name,
        ...(timezone.value ? { timezone: timezone.value } : {}),
        admin: {
          email: adminEmail,
          name: adminName.value ?? '管理者',
          ...(initialPassword ? { initialPassword } : {}),
        },
      },
    );
    const { tenant, admin } = result;
    console.log(
      `[tenant] テナント${result.tenantCreated ? 'を作成しました' : 'は既にあります'}: ${tenant.name}` +
        `(slug=${tenant.slug}, id=${tenant.id}, timezone=${tenant.timezone})`,
    );
    if (!admin.created) {
      console.log(
        `[tenant] ${adminEmail} は既に登録されています(役割 ${admin.role})。権限・パスワードは変えていません。`,
      );
      return;
    }
    console.log(`[tenant] 最初の管理者を作成しました: ${adminEmail}(staffId=${admin.staffId})`);
    if (initialPassword) {
      console.log(`[tenant] 初期パスワード(この1回だけ表示します): ${initialPassword}`);
    } else {
      console.log(
        '[tenant] パスワードは未設定です。ログイン画面の「パスワードを忘れた方」から設定してもらってください' +
          '(再設定メールはワーカーが送ります)。',
      );
    }
  } finally {
    await Promise.all([closeDatabase(ownerDb), closeDatabase(appDb)]);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
