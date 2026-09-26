import { loadDotenv } from '../loadDotenv';

loadDotenv();

import { type TenantCalendarChanges, updateTenantCalendarSettings } from '@katahimo/core/usecases';
import { closeDatabase, createDatabase } from '@katahimo/db';
import {
  DrizzleAppLogRepository,
  DrizzleTenantCalendarSettingsStore,
  DrizzleTenantDirectory,
} from '@katahimo/db/repositories';
import { cliArgs } from './cliArgs';

const USAGE = [
  '使い方: pnpm tenant:calendars -- <slug> [--add-shared <カレンダーID[=持ち主のスタッフ名]>]... [--remove-shared <カレンダーID>]...',
  '                                        [--allow <カレンダーID | @ドメイン>]... [--disallow <カレンダーID | @ドメイン>]...',
  '  オプションを付けなければ今の設定を表示する。@gmail.com 等の誰でも作れるドメインは --allow の後方一致にできない',
].join('\n');

const OPTIONS = {
  '--add-shared': 'addShared',
  '--remove-shared': 'removeShared',
  '--allow': 'allow',
  '--disallow': 'disallow',
} as const satisfies Record<string, keyof TenantCalendarChanges>;

/** `--opt 値` を何回でも受け取る。知らないオプション・値の無いオプションは null。 */
function parseChanges(args: string[]): TenantCalendarChanges | null {
  const changes: Required<TenantCalendarChanges> = {
    addShared: [],
    removeShared: [],
    allow: [],
    disallow: [],
  };
  for (let i = 0; i < args.length; i += 2) {
    const key = OPTIONS[args[i] as keyof typeof OPTIONS];
    const value = args[i + 1];
    if (!key || value === undefined) return null;
    changes[key].push(value);
  }
  return changes;
}

/**
 * テナントのカレンダーの設定(共有カレンダー・スタッフに設定できるカレンダーの許可)を運用担当者が見る・変える
 * (doc/07_インフラ・運用.md)。platform.tenants は所有者しか書けないため MIGRATION_DATABASE_URL の接続で動く。
 * テナントの管理者は画面からこの設定を変えられない(別のテナントのカレンダーを読ませないため。doc/06)。
 */
async function main() {
  const [slug, ...rest] = cliArgs();
  const changes = slug ? parseChanges(rest) : null;
  if (!slug || !changes) {
    console.error(USAGE);
    process.exit(1);
  }
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  if (!migrationUrl)
    throw new Error('カレンダーの設定には MIGRATION_DATABASE_URL(katahimo_migrator)が必要です');

  const ownerDb = createDatabase(migrationUrl, { max: 1, onnotice: () => {} });
  try {
    const { settings } = await updateTenantCalendarSettings(
      {
        tenants: new DrizzleTenantDirectory(ownerDb),
        calendarSettings: new DrizzleTenantCalendarSettingsStore(ownerDb),
        appLog: new DrizzleAppLogRepository(ownerDb),
      },
      slug,
      changes,
    );
    console.log(`[calendars] ${slug} の共有カレンダー(${settings.sharedCalendars.length}件):`);
    for (const s of settings.sharedCalendars)
      console.log(`  ${s.calendarId}${s.ownerName ? ` = ${s.ownerName}` : ''}`);
    console.log(`[calendars] スタッフに設定できるカレンダー(${settings.allowedStaffCalendars.length}件):`);
    for (const rule of settings.allowedStaffCalendars) console.log(`  ${rule}`);
  } finally {
    await closeDatabase(ownerDb);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
