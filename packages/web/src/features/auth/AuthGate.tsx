import type { SessionUser } from '@katahimo/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { setUnauthenticatedListener } from '../../api/client';
import { queryKeys } from '../../api/queryKeys';
import { NETWORK_ERROR_MESSAGE } from '../../lib/messages';
import { clearDeviceCaches } from '../../lib/storage';
import { ErrorState } from '../../ui/StatusViews';
import { DemoTermsProvider } from './demo';
import { LoginScreen } from './LoginScreen';
import { SessionProvider, sessionHint, useSessionQuery } from './session';

/** セッションが切れていたときの案内(GAS版 checkLogin と同じ文言)。 */
export const SESSION_EXPIRED_MESSAGE = 'しばらく使っていなかったので、もう一度ログインしてください';

/**
 * ログインしていればアプリ本体(children)を、していなければログイン画面を出す(GAS版 checkLogin)。
 *
 * - 確認中(GET /api/auth/me の応答待ち)は、GAS版と同じくログイン画面を出しておく
 *   (GAS版はページを開いた時点でログインダイアログが表示されており、確認できたら閉じる)。
 * - 「ログインしていない」と決めるのは、サーバーが 401 を返したときだけ。電波が悪いなどで確かめられなかった
 *   ときは、ログイン画面ではなく「もう一度読み込む」を出す(セッションは生きているかもしれないため)。
 * - 公開デモのテナント(`user.demoTenant`)では注釈(DemoTermsProvider)を置き、ログインの画面からログインした直後に出す。
 * - 以前ログインしていたのにセッションが無効だった場合、または使っている途中で401が返った場合は
 *   「しばらく使っていなかったので、もう一度ログインしてください」を出す。
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const session = useSessionQuery();
  const [expiredMessage, setExpiredMessage] = useState('');
  // 公開デモ: ログインの画面からログインした直後だけ注釈を出す(ページの読み込み直しでは出さない)
  const [demoTermsOnMount, setDemoTermsOnMount] = useState(false);

  // 起動時: 以前ログインしていた印があるのにセッションが無い(401) = 期限切れ
  const user = session.data ?? null;
  const loggedOut = session.isSuccess && user === null;
  useEffect(() => {
    if (loggedOut && sessionHint.consume()) setExpiredMessage(SESSION_EXPIRED_MESSAGE);
  }, [loggedOut]);

  // 使っている途中でセッションが切れた(どこかのAPIが401を返した)
  useEffect(() => {
    setUnauthenticatedListener(() => {
      sessionHint.consume();
      setExpiredMessage(SESSION_EXPIRED_MESSAGE);
      // 別のスタッフが続けてログインしても前の人のデータが見えないよう、読み込み済みのデータと
      // この端末の表示用キャッシュを捨てる(書きかけの日報など人ごとの値は、その人にしか見えないので残す)
      clearDeviceCaches();
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.session[0] });
      queryClient.setQueryData(queryKeys.session, null);
    });
    return () => setUnauthenticatedListener(null);
  }, [queryClient]);

  const onLoggedIn = (staff: SessionUser) => {
    sessionHint.mark();
    setExpiredMessage('');
    setDemoTermsOnMount(staff.demoTenant);
    queryClient.setQueryData(queryKeys.session, staff);
  };

  if (session.isError && !user) {
    return <SessionCheckFailed retrying={session.isFetching} onRetry={() => void session.refetch()} />;
  }
  if (!user) {
    // key: 案内の文言が変わったらログイン画面を作り直して反映する
    return <LoginScreen key={expiredMessage} initialError={expiredMessage} onLoggedIn={onLoggedIn} />;
  }
  return (
    <SessionProvider user={user}>
      {user.demoTenant ? (
        <DemoTermsProvider showOnMount={demoTermsOnMount}>{children}</DemoTermsProvider>
      ) : (
        children
      )}
    </SessionProvider>
  );
}

/** ログインしているか確かめられなかった(通信の失敗など)。ログイン画面と同じ暗い背景に出す。 */
function SessionCheckFailed({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div className="fixed inset-0 bg-gray-900 z-50 flex items-center justify-center p-4">
      <div role="alert" className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4">
        <ErrorState message={NETWORK_ERROR_MESSAGE} />
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="w-full min-h-12 py-3 bg-blue-600 text-white text-base font-bold rounded-xl"
        >
          {retrying ? '確認中...' : 'もう一度読み込む'}
        </button>
      </div>
    </div>
  );
}
