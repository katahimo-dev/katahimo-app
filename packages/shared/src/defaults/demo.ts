import type { StaffRole } from '../contracts/roles';

/**
 * 公開デモ(1つのデモ用テナントを訪問者みんなで使う)のログイン用アカウント。
 * - シード(`pnpm demo:reset`)がこの3人を作り、デモ専用の環境(API の `DEMO_PUBLIC_LOGIN=true`)では
 *   GET /api/demo/config がこの一覧とパスワードを返して、ログイン画面に出す。
 * - API は、デモ用テナント(`DEMO_TENANT_SLUG`)では、この3人の変更・削除・パスワードの変更を断る
 *   (1人の操作で他の訪問者がログインできなくならないように。`packages/api/src/http/demoRestrictions.ts`)。
 * パスワードは公開してよい値(デモのデータは架空のもので、毎晩作り直す)。本番のテナントでは使わない。
 */
export interface DemoAccount {
  role: StaffRole;
  /** ログイン画面に出す役割の名前。 */
  label: string;
  email: string;
  name: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { role: 'admin', label: '管理者', email: 'admin@demo.example.com', name: '山田 花子' },
  {
    role: 'coordinator',
    label: 'コーディネーター',
    email: 'coordinator@demo.example.com',
    name: '佐藤 美咲',
  },
  { role: 'staff', label: 'スタッフ', email: 'staff@demo.example.com', name: '鈴木 一郎' },
];

export const DEMO_PASSWORD = 'demo1234';

/**
 * 公開デモ用テナントの slug の例(ドキュメント・ログイン画面の既定)。開発用のシード(`pnpm db:seed`)の `demo` とは別にする
 * (作り直しで開発・e2e のデータを消さないため)。実際の値は API の `DEMO_TENANT_SLUG` と web の `VITE_DEFAULT_TENANT_SLUG`。
 */
export const DEFAULT_DEMO_TENANT_SLUG = 'public-demo';

/** デモ用テナントで、1回のログイン(セッション)で使える AI の回数(日報・事故報告の生成と領収書の読み取りの合計)。 */
export const DEMO_AI_USES_PER_SESSION = 10;
