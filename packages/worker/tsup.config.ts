import { defineConfig } from 'tsup';

// 本番用ビルド(Dockerfile の worker イメージ)。常駐ポーラー(main)と Cloud Run Jobs 用のジョブ
// (entrypoints/*)を別々のファイルに出力し、同じイメージの起動コマンドで切り替える。
// @katahimo/* の取り込み方針は packages/api/tsup.config.ts と同じ。
export default defineConfig({
  entry: {
    main: 'src/main.ts',
    'outbox-once': 'src/entrypoints/outboxOnce.ts',
    'nightly-calendar-sync': 'src/entrypoints/nightlyCalendarSync.ts',
    'csv-import': 'src/entrypoints/csvImport.ts',
    'sync-busy-blocks': 'src/entrypoints/syncBusyBlocks.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // 共通部分をチャンクに分けず、ジョブごとに1ファイルで完結させる
  splitting: false,
  removeNodeProtocol: false,
  skipNodeModulesBundle: true,
  noExternal: [/^@katahimo\//],
});
