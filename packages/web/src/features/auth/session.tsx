import type { SessionUser } from '@katahimo/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useMemo } from 'react';
import { authApi } from '../../api/auth';
import { isUnauthenticated } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from '../../lib/storage';

/**
 * ログイン状態。GET /api/auth/me の結果を TanStack Query で持つ(未ログインなら null)。
 * GAS版はトークンをlocalStorageに置いていたが、新方式はhttpOnly Cookieのため、
 * 画面側が持つのは「誰がログインしているか」だけ。
 */
async function fetchSessionUser(signal?: AbortSignal): Promise<SessionUser | null> {
  try {
    const res = await authApi.me(signal);
    return res.staff;
  } catch (e) {
    if (isUnauthenticated(e)) return null;
    throw e;
  }
}

export function useSessionQuery() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: ({ signal }) => fetchSessionUser(signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

/** ログインしていた印(期限切れの案内を出し分けるため。lib/storage.ts の sessionHint 参照)。 */
export const sessionHint = {
  mark: () => writeStorage(STORAGE_KEYS.sessionHint, '1'),
  consume: (): boolean => {
    const had = readStorage(STORAGE_KEYS.sessionHint) === '1';
    removeStorage(STORAGE_KEYS.sessionHint);
    return had;
  },
};

interface SessionContextValue {
  /** ログイン中のスタッフ(isAdmin で管理者向けの表示を出し分ける) */
  user: SessionUser;
  /** ログアウトして画面を読み込み直す(GAS版 doLogout と同じく location.reload する) */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const queryClient = useQueryClient();
  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // サーバーに届かなくても画面上はログアウトする(次に開いたときは /me で確認し直す)
    }
    removeStorage(STORAGE_KEYS.sessionHint);
    queryClient.clear();
    window.location.reload();
  }, [queryClient]);

  const value = useMemo(() => ({ user, logout }), [user, logout]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** ログイン後の画面(AppShell 以下)でだけ使える。 */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession はログイン後の画面(SessionProvider の中)で使ってください');
  return value;
}
