import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { type TenantCustomerSourceChange, updateTenantCustomerImportSettings } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import {
  DrizzleAppLogRepository,
  DrizzleTenantCustomerImportSettingsStore,
  DrizzleTenantDirectory,
} from '@katahimo/db/repositories';
import { cliArgs } from './cliArgs';

const USAGE = [
  '使い方: pnpm tenant:customer-source -- <slug> [--drive-folder <DriveフォルダID> | --clear]',
  '  オプションを付けなければ今の設定を表示する。--drive-folder は RESERVA の顧客CSV(Kokyaku_*.csv)を置くフォルダ',
  '  (API・ワーカーのサービスアカウントに閲覧者で共有しておく)。--clear で夜間の顧客CSV取込の対象から外す',
].join('\n');

/** 引数を変更の指定にする。組み合わせの誤り・知らないオプションは null。 */
function parseChange(args: string[]): TenantCustomerSourceChange | null {
  if (args.length === 0) return { kind: 'show' };
  if (args.length === 1 && args[0] === '--clear') return { kind: 'clear' };
  if (args.length === 2 && args[0] === '--drive-folder' && args[1]) {
    return { kind: 'drive_folder', driveFolderId: args[1] };
  }
  return null;
}

/**
 * テナントの顧客データの取込元(platform.tenants.customer_import_settings)を運用担当者が見る・変える
 * (doc/07_インフラ・運用.md)。platform.tenants は所有者しか書けないため MIGRATION_DATABASE_URL の接続で動く。
 * テナントの管理者は画面からこの設定を変えられない(別のテナントの顧客CSVを取り込ませないため。doc/06)。
 */
async function main() {
  const [slug, ...rest] = cliArgs();
  const change = slug ? parseChange(rest) : null;
  if (!slug || !change) {
    console.error(USAGE);
    process.exit(1);
  }
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl)
    throw new Error('顧客データの取込元の設定には MIGRATION_DATABASE_URL(katahimo_migrator)が必要です');

  const ownerDb = createDatabase(migrationUrl, { max: 1, onnotice: () => {} });
  try {
    const { settings } = await updateTenantCustomerImportSettings(
      {
        tenants: new DrizzleTenantDirectory(ownerDb),
        customerImportSettings: new DrizzleTenantCustomerImportSettingsStore(ownerDb),
        appLog: new DrizzleAppLogRepository(ownerDb),
      },
      slug,
      change,
    );
    if (change.kind !== 'show') console.log(`[customer-source] ${slug} の設定を変えました`);
    console.log(
      settings
        ? `[customer-source] ${slug} の取込元: RESERVA の顧客CSV / Google Drive のフォルダ ${settings.driveFolderId}`
        : `[customer-source] ${slug} の取込元: 未設定(夜間の顧客CSV取込の対象外)`,
    );
  } finally {
    await closeDatabase(ownerDb);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
