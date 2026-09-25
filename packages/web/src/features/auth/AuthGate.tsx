import type { SessionUser } from '@katahimo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { setUnauthenticatedListener } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { LoginScreen } from './LoginScreen';
import { SessionProvider, sessionHint, useSessionQuery } from './session';

/** セッションが切れていたときの案内(GAS版 checkLogin と同じ文言)。 */
export const SESSION_EXPIRED_MESSAGE = 'しばらく使っていなかったので、もう一度ログインしてください';

/**
 * ログインしていればアプリ本体(children)を、していなければログイン画面を出す(GAS版 checkLogin)。
 *
 * - 確認中(GET /api/auth/me の応答待ち)は、GAS版と同じくログイン画面を出しておく
 *   (GAS版はページを開いた時点でログインダイアログが表示されており、確認できたら閉じる)。
 * - 以前ログインしていたのにセッションが無効だった場合、または使っている途中で401が返った場合は
 *   「しばらく使っていなかったので、もう一度ログインしてください」を出す。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useSessionQuery();
  const [expiredMessage, setExpiredMessage] = useState('');

  // 起動時: 以前ログインしていた印があるのにセッションが無い = 期限切れ
  const user = session.data ?? null;
  const checked = session.isSuccess || session.isError;
  useEffect(() => {
    if (!checked || user) return;
    if (sessionHint.consume()) setExpiredMessage(SESSION_EXPIRED_MESSAGE);
  }, [checked, user]);

  // 使っている途中でセッションが切れた(どこかのAPIが401を返した)
  useEffect(() => {
    setUnauthenticatedListener(() => {
      sessionHint.consume();
      setExpiredMessage(SESSION_EXPIRED_MESSAGE);
      // 別のスタッフが続けてログインしても前の人のデータが見えないよう、読み込み済みのデータを捨てる
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.session[0] });
      queryClient.setQueryData(queryKeys.session, null);
    });
    return () => setUnauthenticatedListener(null);
  }, [queryClient]);

  const onLoggedIn = (staff: SessionUser) => {
    sessionHint.mark();
    setExpiredMessage('');
    queryClient.setQueryData(queryKeys.session, staff);
  };

  if (!user) {
    // key: 案内の文言が変わったらログイン画面を作り直して反映する
    return <LoginScreen key={expiredMessage} initialError={expiredMessage} onLoggedIn={onLoggedIn} />;
  }
  return <SessionProvider user={user}>{children}</SessionProvider>;
}
