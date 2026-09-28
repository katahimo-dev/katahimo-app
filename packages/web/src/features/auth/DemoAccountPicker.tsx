import { DEMO_ACCOUNTS, DEMO_PASSWORD, type DemoAccount } from '@katahimo/shared';
import { DEMO_NOTICE } from '../../lib/demo';

/** 公開デモのログイン画面に出す、デモ用アカウントの一覧(押すとメールアドレスとパスワードを入れる)。 */
export function DemoAccountPicker({ onPick }: { onPick: (account: DemoAccount, password: string) => void }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-bold text-amber-900">デモ用アカウント(パスワード: {DEMO_PASSWORD})</p>
      <div className="grid grid-cols-3 gap-2">
        {DEMO_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            onClick={() => onPick(account, DEMO_PASSWORD)}
            className="min-h-11 px-2 rounded-lg bg-white border border-amber-300 text-sm font-bold text-amber-900"
          >
            {account.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-amber-900">{DEMO_NOTICE}</p>
    </div>
  );
}
