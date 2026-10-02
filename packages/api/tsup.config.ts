import { defineConfig } from 'tsup';

// 本番用ビルド(Dockerfile の api イメージ)。ワークスペース内パッケージ(@katahimo/*)は TypeScript の
// ソースを直接 export しているため取り込み、それ以外の依存(googleapis 等)はバンドルせず
// 実行時に node_modules から読む(Dockerfile で本番依存だけを入れる)。
export default defineConfig({
  // demo-reset: 公開デモ用テナントの毎晩の作り直し(Cloud Run の Job で `node dist/demo-reset.js <slug>`。doc/07 3.9)
  entry: { server: 'src/server.ts', 'demo-reset': 'src/scripts/demoReset.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // node: 接頭辞を残す(tsup の既定は互換のため取り除く)
  removeNodeProtocol: false,
  skipNodeModulesBundle: true,
  noExternal: [/^@katahimo\//],
});
