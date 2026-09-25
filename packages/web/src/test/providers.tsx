import type { SessionUser } from '@katahimo/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SessionProvider } from '../features/auth/session';
import { ConfirmModalProvider } from '../ui/confirm';

/** テスト用のスタッフ(ログイン中) */
export const TEST_USER: SessionUser = {
  staffId: '00000000-0000-4000-8000-00000000a001',
  tenantId: '00000000-0000-4000-8000-000000000001',
  name: '管理者 太郎',
  email: 'admin@example.com',
  role: 'admin',
};

export function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

/** QueryClient + 確認ダイアログ(+ ログイン中のスタッフ)で包む */
export function createWrapper({
  queryClient = createTestQueryClient(),
  user = TEST_USER as SessionUser | null,
}: {
  queryClient?: QueryClient;
  user?: SessionUser | null;
} = {}) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ConfirmModalProvider>
          {user ? <SessionProvider user={user}>{children}</SessionProvider> : children}
        </ConfirmModalProvider>
      </QueryClientProvider>
    );
  };
}

/** 外から resolve / reject できる Promise(通信の返事の順番を決めるテスト用) */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
