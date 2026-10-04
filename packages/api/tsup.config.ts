import { defineConfig } from 'tsup';

// 本番用ビルド(Dockerfile の api イメージ)。ワークスペース内パッケージ(@katahimo/*)は TypeScript の
// ソースを直接 export しているため取り込み、それ以外の依存(googleapis 等)はバンドルせず
// 実行時に node_modules から読む(Dockerfile で本番依存だけを入れる)。
export default defineConfig({
  entry: {
    server: 'src/server.ts',
    // demo-reset: 公開デモ用テナントの毎晩の作り直し(Cloud Run の Job で `node dist/demo-reset.js <slug>`。doc/07 3.9)
    'demo-reset': 'src/scripts/demoReset.ts',
    // ops/*: 運用スクリプト(Cloud Run Job katahimo-ops で `node dist/ops/<名前>.js <引数>`。DB がプライベート IP だけのため
    // 手元からは流さない。infra/gcp/run.tf・doc/07 3.6)。一覧は ops/help.js が出す(opsHelp.ts の OPS_SCRIPTS と揃える)
    'ops/help': 'src/scripts/opsHelp.ts',
    'ops/tenant-create': 'src/scripts/createTenant.ts',
    'ops/tenant-calendars': 'src/scripts/tenantCalendars.ts',
    'ops/tenant-customer-source': 'src/scripts/tenantCustomerSource.ts',
    'ops/tenant-api-keys': 'src/scripts/tenantApiKeys.ts',
    'ops/import-reserva': 'src/scripts/importReservaCsv.ts',
    'ops/import-staff-master': 'src/scripts/importStaffMasterCsv.ts',
    'ops/import-attendance': 'src/scripts/importAttendanceCsv.ts',
    'ops/import-legacy-reports': 'src/scripts/importLegacyReports.ts',
    'ops/import-legacy-receipts': 'src/scripts/importLegacyReceipts.ts',
    'ops/ai-compare': 'src/scripts/aiCompare.ts',
  },
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
