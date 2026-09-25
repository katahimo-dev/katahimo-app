import { existsSync } from 'node:fs';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// DB の結合テストの接続先(DATABASE_URL 等)をルートの .env から読む(既に環境変数があればそちらを優先)
if (existsSync('.env')) loadDotenv({ path: '.env' });

/** DB の結合テスト(*.integration.test.ts)は DATABASE_URL があるときだけ動かす(CI は test-db で用意する)。 */
const withDatabase = Boolean(process.env.DATABASE_URL && process.env.MIGRATION_DATABASE_URL);

/**
 * テストのまとまり(vitest の projects)。
 * - unit: サーバー側の単体テスト(node)
 * - integration: 実際の PostgreSQL に対する結合テスト(RLS・制約・トリガー・並行性)。同じ DB を使うため直列に動かす
 * - web: 画面(jsdom、packages/web/vitest.config.ts)
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: ['packages/web/**', '**/*.integration.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      ...(withDatabase
        ? [
            {
              test: {
                name: 'integration',
                include: ['packages/*/src/**/*.integration.test.ts'],
                environment: 'node' as const,
                fileParallelism: false,
                testTimeout: 30_000,
                hookTimeout: 60_000,
              },
            },
          ]
        : []),
      './packages/web/vitest.config.ts',
    ],
  },
});
