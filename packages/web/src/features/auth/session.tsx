import type { SessionUser } from '@katahimo/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';
import { authApi } from '../../api/auth';
import { isUnauthenticated } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import {
  clearDeviceCaches,
  readStorage,
  removeStorage,
  removeUnscopedUserData,
  removeUserScopedData,
  STORAGE_KEYS,
  type UserStorageScope,
  writeStorage,
} from '../../lib/storage';

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
  /** この人の localStorage の値のキーに使う(lib/storage.ts の userStorageKey) */
  storageScope: UserStorageScope;
  /** ログアウトして画面を読み込み直す(GAS版 doLogout と同じく location.reload する) */
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  const queryClient = useQueryClient();
  const storageScope = useMemo(
    () => ({ tenantId: user.tenantId, staffId: user.staffId }),
    [user.tenantId, user.staffId],
  );

  // 人ごとに分ける前の(誰のものか分からない)値は使わずに消す
  useEffect(() => removeUnscopedUserData(), []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // サーバーに届かなくても画面上はログアウトする(次に開いたときは /me で確認し直す)
    }
    removeStorage(STORAGE_KEYS.sessionHint);
    // この端末を次に使う人に、書きかけの日報・最近のお客様・予定や出勤簿のキャッシュが残らないようにする
    removeUserScopedData(storageScope);
    clearDeviceCaches();
    queryClient.clear();
    window.location.reload();
  }, [queryClient, storageScope]);

  const value = useMemo(() => ({ user, storageScope, logout }), [user, storageScope, logout]);
  return <SessionContext value={value}>{children}</SessionContext>;
}

/** ログイン後の画面(AppShell 以下)でだけ使える。 */
export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession はログイン後の画面(SessionProvider の中)で使ってください');
  return value;
}
