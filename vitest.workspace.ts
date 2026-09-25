import { defineWorkspace } from 'vitest/config';

/**
 * テストのまとまり。サーバー側(node)は vitest.config.ts、画面(jsdom)は packages/web/vitest.config.ts。
 */
export default defineWorkspace([
  { extends: './vitest.config.ts', test: { name: 'node' } },
  './packages/web/vitest.config.ts',
]);
