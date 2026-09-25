import { defineProject } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

/**
 * 画面(packages/web)のテスト。部品・フックのテスト(*.test.tsx)は jsdom の上で
 * @testing-library/react を使って動かす。純粋な関数のテスト(*.test.ts)も同じ設定で動く。
 * ルートの vitest.workspace.ts から読まれる(`pnpm test` でまとめて動く)。
 */
export default defineProject({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  esbuild: { jsx: 'automatic' },
  test: {
    name: 'web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
