import type { useVisibilityToggle } from '../../ui/useVisibilityToggle';

export interface LoginFormValues {
  tenantSlug: string;
  email: string;
  password: string;
}

interface LoginModalProps {
  values: LoginFormValues;
  onChange: (values: LoginFormValues) => void;
  /** 法人IDが決まらなかったときだけ「法人ID」欄を出す(lib/tenant.ts) */
  showTenantField: boolean;
  error: string;
  submitting: boolean;
  passwordVisibility: ReturnType<typeof useVisibilityToggle>;
  onSubmit: () => void;
  onForgotPassword: () => void;
}

/** GAS版 #loginModal と同じ見た目。入力の検証・送信は LoginScreen が行う。 */
export function LoginModal({
  values,
  onChange,
  showTenantField,
  error,
  submitting,
  passwordVisibility,
  onSubmit,
  onForgotPassword,
}: LoginModalProps) {
  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800">ログイン</h2>
          <p className="text-sm text-gray-500 mt-1">スタッフ情報を入力してください</p>
        </div>
        <div className="space-y-4">
          {showTenantField ? (
            <div>
              <label htmlFor="loginTenant" className="block text-base font-bold text-gray-700 mb-1">
                法人ID
              </label>
              <input
                type="text"
                id="loginTenant"
                autoCapitalize="none"
                autoComplete="organization"
                value={values.tenantSlug}
                onChange={(e) => onChange({ ...values, tenantSlug: e.target.value })}
                className="w-full p-3 text-base rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500"
                placeholder="事務局から伝えられたID"
              />
            </div>
          ) : null}
          <div>
            <label htmlFor="loginEmail" className="block text-base font-bold text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              type="text"
              id="loginEmail"
              autoCapitalize="none"
              autoComplete="username"
              value={values.email}
              onChange={(e) => onChange({ ...values, email: e.target.value })}
              className="w-full p-3 text-base rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500"
              placeholder="例）staff@example.com"
            />
          </div>
          <div>
            <label htmlFor="loginPass" className="block text-base font-bold text-gray-700 mb-1">
              パスワード
            </label>
            <div className="flex gap-3">
              <input
                type={passwordVisibility.visible ? 'text' : 'password'}
                id="loginPass"
                autoComplete="current-password"
                value={values.password}
                onChange={(e) => onChange({ ...values, password: e.target.value })}
                className="flex-1 min-w-0 p-3 text-base rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={passwordVisibility.toggle}
                className="min-h-11 px-3 rounded-xl bg-gray-200 text-gray-800 text-sm font-bold border border-gray-300"
              >
                {passwordVisibility.visible ? '🙈 隠す' : '👁 見る'}
              </button>
            </div>
          </div>
        </div>
        <div className="text-red-600 text-base text-center min-h-[1.25rem]" role="alert">
          {error}
        </div>
        <div className="text-center">
          <button
            type="button"
            onClick={onForgotPassword}
            className="w-full min-h-11 py-3 rounded-xl bg-gray-200 text-gray-800 text-base font-bold"
          >
            パスワードを忘れたときはこちら
          </button>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="w-full min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl shadow-lg transform transition-transform active:scale-95"
        >
          {submitting ? '確認中...' : 'ログイン'}
        </button>
      </div>
    </div>
  );
}
