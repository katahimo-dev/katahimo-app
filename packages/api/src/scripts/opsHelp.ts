/**
 * 運用スクリプトのジョブ(katahimo-ops)を引数なしで流したときに出す一覧(infra/gcp/run.tf・doc/07_インフラ・運用.md 3.6)。
 * 名前は tsup.config.ts の `ops/*` の entry と揃える(opsHelp.test.ts が確かめる)。
 */
export const OPS_SCRIPTS: ReadonlyArray<{ name: string; pnpm: string; usage: string }> = [
  {
    name: 'tenant-create',
    pnpm: 'tenant:create',
    usage: '<slug> <名前> <管理者のメール> [--admin-name <名前>] [--timezone <IANA>] [--initial-password]',
  },
  {
    name: 'tenant-calendars',
    pnpm: 'tenant:calendars',
    usage: '<slug> [--add-shared <id[=owner]>] [--remove-shared <id>] [--allow <id|@domain>] [--disallow …]',
  },
  {
    name: 'tenant-customer-source',
    pnpm: 'tenant:customer-source',
    usage: '<slug> [--drive-folder <id> | --clear]',
  },
  {
    name: 'tenant-api-keys',
    pnpm: 'tenant:api-keys',
    usage: '<slug> [--create <name> [--source reserva|external_api]] [--revoke <id>]',
  },
  { name: 'import-reserva', pnpm: 'import:reserva', usage: '<slug> /ops/<CSV> [--force]' },
  { name: 'import-staff-master', pnpm: 'import:staff-master', usage: '<slug> /ops/<CSV> [--dry-run]' },
  {
    name: 'import-attendance',
    pnpm: 'import:attendance',
    usage: '<slug> <スタッフのメール> /ops/<CSV> [--year YYYY]',
  },
  {
    name: 'import-legacy-reports',
    pnpm: 'import:legacy-reports',
    usage: '<slug> --spreadsheet <id> [--daily-sheet <名前>] [--accident-sheet <名前>] [--dry-run]',
  },
  {
    name: 'import-legacy-receipts',
    pnpm: 'import:legacy-receipts',
    usage:
      '<slug> --spreadsheet <id> (--month YYYY-MM … | --from YYYY-MM --to YYYY-MM) [--sheet <名前>] [--dry-run]',
  },
  { name: 'ai-compare', pnpm: 'ai:compare', usage: '<slug> --models <m1,m2> … --out /ops/<ファイル名>.html' },
];

export function opsHelpText(): string {
  return [
    '運用スクリプトのジョブ(katahimo-ops)。スクリプトと引数をカンマ区切りで上書きして流す:',
    '  gcloud run jobs execute katahimo-ops --region=asia-northeast1 --wait \\',
    '    --args=dist/ops/<名前>.js,<引数1>,<引数2>,…',
    "引数にカンマを含むとき(--models m1,m2 等)は区切りを変える: --args='^;^dist/ops/<名前>.js;<引数1>;m1,m2'",
    'ファイルは ops バケットに置き(gcloud storage cp <ファイル> gs://<ops バケット>/)、引数では /ops/<ファイル名> と書く。',
    '',
    ...OPS_SCRIPTS.map((s) => `  dist/ops/${s.name}.js ${s.usage}   (= pnpm ${s.pnpm})`),
  ].join('\n');
}

if (process.env.VITEST === undefined) console.log(opsHelpText());
