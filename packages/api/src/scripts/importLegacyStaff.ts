import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { importLegacyStaff } from '@katahimo/core';
import { getDatabase } from '@katahimo/db';
import { createContainer } from '../container';
import { loadEnv } from '../env';

/**
 * GAS版スタッフ台帳(Staffシート)の1行分を、パスワードハッシュ(SHA-256+salt)ごと移行する。
 * 実際の移行では、Sheets APIでStaffシートを読み取り、行ごとにこの関数相当の処理を呼ぶ
 * ドライバをPhase 5(Google連携)で追加する想定。ここでは単発の移行操作として提供する。
 *
 * 使い方: pnpm --filter @katahimo/api exec tsx src/scripts/importLegacyStaff.ts \
 *   <tenantSlug> <氏名> <メールアドレス> <GAS版のパスワードハッシュ(Staffシート列J)> [--admin]
 *
 * 移行したスタッフは、次回ログイン時に入力されたパスワードがこのハッシュと一致すれば、
 * argon2idへサイレント再ハッシュされる(パスワード変更を求めない移行)。
 */
async function main() {
  const [tenantSlug, name, email, legacyPasswordHash, ...rest] = process.argv.slice(2);
  const isAdmin = rest.includes('--admin');

  if (!tenantSlug || !name || !email || !legacyPasswordHash) {
    console.error(
      '使い方: pnpm --filter @katahimo/api exec tsx src/scripts/importLegacyStaff.ts ' +
        '<tenantSlug> <氏名> <メールアドレス> <レガシーパスワードハッシュ> [--admin]',
    );
    process.exit(1);
  }

  const env = loadEnv();
  const db = getDatabase();
  const container = createContainer(env, db);

  const tenant = await container.tenants.findBySlug(tenantSlug);
  if (!tenant) {
    console.error(`テナントが見つかりません: ${tenantSlug}`);
    process.exit(1);
  }

  const staff = await importLegacyStaff(container, {
    tenantId: tenant.id,
    name,
    email,
    legacyPasswordHash,
    isAdmin,
  });
  console.log(`[import] スタッフを移行しました: id=${staff.id}, email=${email}`);
  console.log('次回ログイン時、既存パスワードのままでログインでき、argon2idへ自動的に再ハッシュされます。');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
