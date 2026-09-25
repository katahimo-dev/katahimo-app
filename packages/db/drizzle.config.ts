import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public', 'platform'],
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? '' },
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
