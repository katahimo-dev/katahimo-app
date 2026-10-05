import type { StaffRole } from '../contracts/roles';

/**
 * 公開デモ(1つのデモ用テナントを訪問者みんなで使う)のログイン用アカウント。
 * - シード(`pnpm demo:reset`)がこの3人を作る。認証情報は画面・未ログインAPIへ公開せず、対象者へ別途案内する。
 * - API は、デモ用テナント(`DEMO_TENANT_SLUG`)では、この3人の変更・削除・パスワードの変更を断る
 *   (1人の操作で他の訪問者がログインできなくならないように。`packages/api/src/http/demoRestrictions.ts`)。
 * DEMO_PASSWORD は開発・テスト用。本番の再作成では Secret Manager の DEMO_LOGIN_PASSWORD を使う。
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
