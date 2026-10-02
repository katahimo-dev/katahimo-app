import type { DemoAccountView } from '@katahimo/shared';

/** ログイン画面に出すデモ用アカウント(GET /api/demo/config の accounts・password)。 */
export interface DemoAccountsView {
  accounts: readonly DemoAccountView[];
  password: string;
}

/** 公開デモ(デモ専用の環境)のログイン画面に出す、デモ用アカウントの一覧(押すとメールアドレスとパスワードを入れる)。 */
export function DemoAccountPicker({
  view,
  onPick,
}: {
  view: DemoAccountsView;
  onPick: (account: DemoAccountView, password: string) => void;
}) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-bold text-amber-900">デモ用アカウント(パスワード: {view.password})</p>
      <div className="grid grid-cols-3 gap-2">
        {view.accounts.map((account) => (
          <button
            key={account.email}
            type="button"
            onClick={() => onPick(account, view.password)}
            className="min-h-11 px-2 rounded-lg bg-white border border-amber-300 text-sm font-bold text-amber-900"
          >
            {account.label}
          </button>
        ))}
      </div>
    </div>
  );
}
