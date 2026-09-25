import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 各パッケージの src 配下の *.test.ts をまとめて実行する
    include: ['packages/*/src/**/*.test.ts'],
    // 画面(packages/web)は jsdom で動かすため、別のまとまり(packages/web/vitest.config.ts)にする
    exclude: ['packages/web/**', '**/node_modules/**'],
    environment: 'node',
  },
});
