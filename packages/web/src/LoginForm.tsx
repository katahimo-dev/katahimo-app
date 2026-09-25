import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { StaffView } from './api';
import { login } from './api';

/**
 * GAS版(gas-childcare-visit-app/index.html)のログインモーダルと同じ見た目・文言にしている
 * (移行時の混乱を減らすため)。マルチテナントSaaS化に伴い法人ID(tenantSlug)欄のみ追加。
 */
export function LoginForm({ onLoggedIn }: { onLoggedIn: (staff: StaffView) => void }) {
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => login(tenantSlug, email, password),
    onSuccess: onLoggedIn,
  });

  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-6"
      >
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-800">ログイン</h2>
          <p className="text-sm text-gray-500 mt-1">スタッフ情報を入力してください</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="loginTenant">
              法人ID
            </label>
            <input
              id="loginTenant"
              value={tenantSlug}
              onChange={(e) => setTenantSlug(e.target.value)}
              required
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="loginEmail">
              メールアドレス
            </label>
            <input
              id="loginEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="ex: staff@example.com"
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="loginPassword">
              パスワード
            </label>
            <input
              id="loginPassword"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="text-red-500 text-sm text-center min-h-[1.25rem]">
          {mutation.isError ? mutation.error.message : ''}
        </div>

        <button
          type="submit"
          disabled={mutation.isPending}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors"
        >
          {mutation.isPending ? 'ログイン中…' : 'ログイン'}
        </button>
      </form>
    </div>
  );
}
