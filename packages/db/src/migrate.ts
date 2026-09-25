import { loadDotenv } from './loadDotenv';

loadDotenv();

import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

/**
 * マイグレーションを流す(pnpm db:migrate / Cloud Run Job migrate)。接続は MIGRATION_DATABASE_URL
 * (katahimo_migrator。ログインすると自動で katahimo_owner に SET ROLE される)だけを使い、アプリの
 * DATABASE_URL には決してフォールバックしない(アプリロールで DDL を流す・所有者を取り違える事故を防ぐ)。
 */
const OWNER_ROLE = 'katahimo_owner';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error(
    'MIGRATION_DATABASE_URL が設定されていません(.env.example を参照。DATABASE_URL は使いません)',
  );
  process.exit(1);
}

const db = createDatabase(url, { max: 1, onnotice: () => undefined });
try {
  const [row] = await db.execute<{ current_user: string }>(sql`select current_user`);
  if (row?.current_user !== OWNER_ROLE) {
    throw new Error(
      `マイグレーションは ${OWNER_ROLE} で流す必要があります(現在: ${row?.current_user})。` +
        'MIGRATION_DATABASE_URL は katahimo_migrator(ALTER ROLE … SET role = katahimo_owner 済み)にしてください。',
    );
  }
  // URL.pathname は Windows で先頭に余分な "/" が付き崩れるため fileURLToPath を使う
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
  console.log('マイグレーションを適用しました');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
