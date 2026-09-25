import { defineConfig } from 'tsup';

// 本番用ビルド(Dockerfile の worker イメージに入れる migrate ジョブ)。dist/migrate.js は
// `../drizzle` のマイグレーションを読むため、イメージにも packages/db/drizzle を同じ相対位置で置く。
export default defineConfig({
  entry: ['src/migrate.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  removeNodeProtocol: false,
  skipNodeModulesBundle: true,
  noExternal: [/^@katahimo\//],
});
