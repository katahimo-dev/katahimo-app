interface ResetRequestModalProps {
  email: string;
  onEmailChange: (email: string) => void;
  /** 法人IDが決まっていないときだけ出す(ログイン画面の「法人ID」欄と同じ値を使う) */
  showTenantField: boolean;
  tenantSlug: string;
  onTenantSlugChange: (slug: string) => void;
  error: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

/** GAS版 #resetRequestModal と同じ見た目(中身は <form>。Enter でも送れる)。 */
export function ResetRequestModal({
  email,
  onEmailChange,
  showTenantField,
  tenantSlug,
  onTenantSlugChange,
  error,
  submitting,
  onCancel,
  onSubmit,
}: ResetRequestModalProps) {
  return (
    <div className="fixed inset-0 bg-gray-900 z-[60] flex items-center justify-center p-4">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4"
      >
        <h3 className="text-xl font-bold text-gray-800">パスワード再設定</h3>
        <p className="text-base text-gray-600">
          登録したメールアドレスを入力してください。
          <br />
          6けたの番号をメールでお送りします。
        </p>
        {showTenantField ? (
          <input
            type="text"
            aria-label="法人ID"
            autoCapitalize="none"
            autoComplete="organization"
            value={tenantSlug}
            onChange={(e) => onTenantSlugChange(e.target.value)}
            className="w-full p-3 text-base rounded-xl border border-gray-300"
            placeholder="法人ID（事務局から伝えられたID）"
          />
        ) : null}
        <input
          type="email"
          id="resetUserId"
          aria-label="メールアドレス"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="username"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          className="w-full p-3 text-base rounded-xl border border-gray-300"
          placeholder="例）staff@example.com"
        />
        <div className="text-red-600 text-base text-center" role="alert">
          {error}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 min-h-12 py-3 bg-gray-200 text-gray-800 text-base font-bold rounded-xl"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
          >
            {submitting ? '送信中...' : '番号をメールで受け取る'}
          </button>
        </div>
      </form>
    </div>
  );
}
