import { loadDotenv } from './loadDotenv';

loadDotenv();

import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL が設定されていません(.env.example を参照)');

const db = createDatabase(url);
// URL.pathname はWindowsで先頭に余分な "/" が付き崩れるため fileURLToPath を使う
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
console.log('マイグレーションを適用しました');
process.exit(0);
