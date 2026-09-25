import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 各パッケージの src 配下の *.test.ts をまとめて実行する
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
